'use strict';

// Loaded as a plain script (no bundler in this project), so it attaches
// itself to `window`. Kept deliberately small and hand-written rather than
// pulled from mermaid's own doc examples, so every template is something
// you'd actually start a real diagram from.
window.VAULT_TEMPLATES = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    tag: 'flow',
    code: `flowchart TD
    Start([Start]) --> Input[/Gather requirements/]
    Input --> Decision{Ready to build?}
    Decision -- No --> Input
    Decision -- Yes --> Build[Build the thing]
    Build --> Test{Tests pass?}
    Test -- No --> Build
    Test -- Yes --> Ship([Ship it])`
  },
  {
    id: 'sequence',
    name: 'Sequence Diagram',
    tag: 'sequence',
    code: `sequenceDiagram
    actor User
    participant Client
    participant API
    participant DB

    User->>Client: Submit form
    Client->>API: POST /orders
    API->>DB: INSERT order
    DB-->>API: order id
    API-->>Client: 201 Created
    Client-->>User: Show confirmation`
  },
  {
    id: 'class',
    name: 'Class Diagram',
    tag: 'class',
    code: `classDiagram
    class Order {
      +String id
      +Date placedAt
      +OrderStatus status
      +addLine(item, qty)
      +total() Money
    }
    class OrderLine {
      +String sku
      +Int quantity
      +Money unitPrice
    }
    class OrderStatus {
      <<enumeration>>
      PENDING
      PAID
      SHIPPED
      CANCELLED
    }
    Order "1" *-- "many" OrderLine : contains
    Order --> OrderStatus`
  },
  {
    id: 'state',
    name: 'State Diagram',
    tag: 'state',
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> InReview: submit
    InReview --> Draft: request changes
    InReview --> Approved: approve
    Approved --> Published: publish
    Published --> Archived: archive
    Archived --> [*]`
  },
  {
    id: 'er',
    name: 'Entity Relationship',
    tag: 'data',
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_LINE : contains
    PRODUCT ||--o{ ORDER_LINE : "ordered in"

    CUSTOMER {
      string id PK
      string name
      string email
    }
    ORDER {
      string id PK
      date placed_at
      string customer_id FK
    }
    PRODUCT {
      string sku PK
      string name
      decimal price
    }`
  },
  {
    id: 'gantt',
    name: 'Gantt Chart',
    tag: 'planning',
    code: `gantt
    title Project Timeline
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d

    section Discovery
    Research           :done,    d1, 2026-01-05, 5d
    Requirements       :done,    d2, after d1, 4d

    section Build
    Backend            :active,  b1, after d2, 10d
    Frontend           :         b2, after d2, 12d

    section Launch
    QA                 :         q1, after b2, 5d
    Release            :milestone, m1, after q1, 0d`
  },
  {
    id: 'pie',
    name: 'Pie Chart',
    tag: 'data',
    code: `pie showData title Time Spent This Sprint
    "Feature work" : 45
    "Bug fixes" : 20
    "Code review" : 15
    "Meetings" : 15
    "On call" : 5`
  },
  {
    id: 'journey',
    name: 'User Journey',
    tag: 'ux',
    code: `journey
    title Signing up for an account
    section Discovery
      Find the landing page: 4: User
      Read the pricing page: 3: User
    section Signup
      Fill in the form: 3: User
      Confirm email: 2: User
    section First use
      Complete onboarding: 4: User
      Invite a teammate: 5: User`
  },
  {
    id: 'gitgraph',
    name: 'Git Graph',
    tag: 'dev',
    code: `gitGraph
    commit id: "init"
    branch develop
    checkout develop
    commit id: "feature A"
    commit id: "feature B"
    checkout main
    merge develop
    commit id: "release 1.0" tag: "v1.0"`
  },
  {
    id: 'mindmap',
    name: 'Mind Map',
    tag: 'planning',
    code: `mindmap
    root((Diagram Library))
      Organize
        Folders
        Tags
        Search
      Author
        Raw Mermaid
        Live preview
        Templates
      Share
        PNG
        SVG
        PDF`
  },
  {
    id: 'quadrant',
    name: 'Quadrant Chart',
    tag: 'planning',
    code: `quadrantChart
    title Effort vs Impact
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Quick wins
    quadrant-2 Big bets
    quadrant-3 Reconsider
    quadrant-4 Fill-ins
    Refactor auth: [0.75, 0.4]
    New dashboard: [0.7, 0.85]
    Fix typo: [0.1, 0.2]
    Rewrite billing: [0.35, 0.9]`
  },
  {
    id: 'timeline',
    name: 'Timeline',
    tag: 'planning',
    code: `timeline
    title Product History
    2023 : Idea sketched on a napkin
    2024 : v1.0 shipped : First 100 users
    2025 : Rewrote the core engine
    2026 : Opened the plugin ecosystem`
  }
];
