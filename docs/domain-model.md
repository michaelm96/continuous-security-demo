# Organization, Membership, Invoice, and Refund Model

This document isolates the four core domain resources. User/profile records are external references and are intentionally omitted from the diagrams.

## Entity relationships

```mermaid
erDiagram
    ORGANIZATION ||--o{ MEMBERSHIP : has
    ORGANIZATION ||--o{ INVOICE : owns
    ORGANIZATION ||--o{ REFUND : scopes
    INVOICE ||--o{ REFUND : receives

    ORGANIZATION {
        uuid id PK
        string name
        timestamp created_at
        timestamp updated_at
    }

    MEMBERSHIP {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        string role
        string status
        timestamp created_at
        timestamp updated_at
    }

    INVOICE {
        uuid id PK
        uuid organization_id FK
        uuid owner_id FK
        string customer_id
        string description
        bigint amount_minor
        string currency
        string status
        timestamp created_at
        timestamp updated_at
    }

    REFUND {
        uuid id PK
        uuid organization_id FK
        uuid invoice_id FK
        uuid created_by FK
        bigint amount_minor
        string currency
        string reason
        string idempotency_key
        timestamp created_at
    }
```

Key constraints:

- One membership is allowed per `(organization_id, user_id)`.
- One refund idempotency key is allowed per `(invoice_id, idempotency_key)`.
- Membership roles are `user`, `manager`, or `organization_admin`; status is `active` or `suspended`.
- Invoice status is `draft`, `issued`, `paid`, or `cancelled`.
- Every invoice and refund belongs to exactly one organization. A refund also belongs to exactly one invoice.

## Domain workflow

```mermaid
flowchart TD
    A[Authenticated caller selects an organization] --> B[Load caller membership]
    B --> C{Membership exists?}
    C -- No --> D[Return 404<br/>hide foreign tenant]
    C -- Yes --> E{Membership active?}
    E -- No --> F[Return 403]
    E -- Yes --> G{Requested operation}

    G --> H[List memberships]
    H --> I[Query organization memberships]

    G --> J[Update membership role or status]
    J --> K{Organization admin?}
    K -- No --> F
    K -- Yes --> L{Would this remove<br/>the last active admin?}
    L -- Yes --> M[Return 409 last_admin]
    L -- No --> N[Update membership]

    G --> O[List or get invoices]
    O --> P{Caller role}
    P -- user --> Q[Query only caller-owned<br/>invoices and refunds]
    P -- manager or organization_admin --> R[Query all organization<br/>invoices and refunds]

    G --> S[Create invoice or change status]
    S --> T{Manager or<br/>organization_admin?}
    T -- No --> F
    T -- Yes --> U[Create draft invoice or validate transition]
    U --> V[Allowed: draft to issued or cancelled<br/>issued to paid or cancelled]

    G --> W[Create refund]
    W --> X{Manager or<br/>organization_admin?}
    X -- No --> F
    X -- Yes --> Y[Call create_refund transaction]
    Y --> Z[Lock invoice and derive organization]
    Z --> AA{Authorized for the locked<br/>invoice organization?}
    AA -- No membership --> D
    AA -- Inactive or insufficient role --> F
    AA -- Yes --> AB{Idempotency key exists?}
    AB -- Same payload --> AC[Return original refund]
    AB -- Different payload --> AD[Return 409 idempotency_conflict]
    AB -- No --> AE{Invoice issued or paid,<br/>currency matches, amount valid,<br/>cumulative refunds within total?}
    AE -- No --> AF[Reject and audit]
    AE -- Yes --> AG[Insert refund and success audit<br/>in one transaction]

    I --> AH[Caller-scoped database client]
    N --> AH
    Q --> AH
    R --> AH
    V --> AH
    AC --> AH
    AG --> AH
    AH --> AI[Forced row-level security<br/>enforces tenant and ownership boundaries]
    AI --> AJ[Return permitted result]
```

The application checks membership, status, and endpoint roles before domain work. PostgreSQL row-level security independently enforces organization and ownership boundaries. Refund creation adds a second database-side authorization check inside its transaction.
