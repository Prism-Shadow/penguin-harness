/** The company-mode prototype's own words, in English, in the shape of the Chinese dictionary. */
import type { Words } from "./words";

export const en: Words = {
  org: {
    sample: "Floe Studio",
    fresh: "New company",
    tagline: "A one-person company · the open-source notes app Floe",
  },
  colon: ": ",
  you: "You",
  species: {
    emperor: "Emperor",
    chinstrap: "Chinstrap",
    gentoo: "Gentoo",
    adelie: "Adélie",
    king: "King",
  },
  roles: {
    lead: {
      title: "Lead",
      duties:
        "Settles goals with you, builds the team, splits the work into tickets, reviews how it went. Does no work itself.",
    },
    dev: {
      title: "Engineer",
      duties: "Fixes bugs, writes features, opens pull requests. Cannot merge.",
    },
    research: {
      title: "Researcher",
      duties: "Runs evaluations and experiments, and reports curves and conclusions.",
    },
    ops: {
      title: "Operations",
      duties:
        "Writes documents, reviews contracts, reconciles accounts, drafts replies. Never sends anything.",
    },
    verifier: {
      title: "Verifier",
      duties:
        "Checks every delivery against its acceptance criteria, on a read-only token of its own; it can never pass its own work.",
    },
  },
  machines: {
    laptop: { name: "This MacBook Pro", state: "Online" },
    gpu: { name: "gpu-box (SSH)", state: "Online · 1×A100" },
    cloud: { name: "Always-on cloud machine", state: "Standing by" },
  },
  perms: {
    files: "Read and write the workspace",
    branch: "Branch and open PRs",
    tests: "Run tests",
    gpu: "Use the GPU",
    drafts: "Drafts only",
    readonly: "Read-only token",
    noMerge: "Cannot merge",
    tickets: "File and assign tickets",
  },
  workbenches: {
    code: "Code diff",
    experiment: "Experiment curves",
    document: "Long document",
    ledger: "Ledger",
    outreach: "Prefilled drafts",
  },
  work: {
    code: "Code maintenance",
    experiment: "Research experiments",
    document: "Docs and long writing",
    ledger: "Contracts and accounts",
    outreach: "Community and outreach",
  },
  statuses: {
    proposed: "Proposed",
    working: "Working",
    verifying: "Verifying",
    deciding: "Your call",
    done: "Done",
    dropped: "Stopped",
  },
  holders: { person: "You", executor: "Executor", verifier: "Verifier" },
  waits: {
    accept: "To accept",
    ask: "To answer",
    halt: "Halted",
    decide: "To review",
  },
  groups: {
    decide: "Your call",
    moving: "In progress",
    settled: "Settled",
  },
  groupEmpty: {
    decide: "Nothing waits on you",
    moving: "Nothing in progress",
    settled: "Nothing settled yet",
  },
  sources: {
    user: "From you",
    lead: "From the lead",
    github: "GitHub issue",
    message: "Inbound message",
    patrol: "Daily patrol",
    review: "Review proposal",
  },
  outward: {
    actions: {
      reply: "Reply to posts",
      merge: "Merge the PR",
      publish: "Publish",
      email: "Send email",
      experiment: "Run a large experiment",
    },
    grades: {
      draft: "Prefilled draft, you send",
      approve: "One-click approval",
      review: "Review, then approve",
    },
    gradeHint: {
      draft: "The company writes drafts and never sends them",
      approve: "Once verified, one click runs it",
      review: "See what it costs and whom it binds, then confirm",
    },
  },
  triggers: {
    github: "GitHub issues",
    message: "Inbound messages (email, forms)",
    callback: "Callbacks (CI, payments)",
    patrol: "Daily patrol at 09:00",
    review: "Weekly review on Fridays",
  },
  scenarios: {
    solo: {
      label: "One-person company",
      line: "Code, experiments, docs and community",
      prompt:
        "I run an open-source notes app on my own and sell a hosted plan. Take care of the code, evaluations, docs and community replies.",
    },
    software: {
      label: "Software upkeep",
      line: "Issues, fixes, pull requests, docs",
      prompt:
        "Help me maintain an open-source repository: triage issues, fix bugs, keep the docs current.",
    },
    research: {
      label: "Research",
      line: "Evaluations, curves, reports",
      prompt: "Run model evaluations for me, chart the results and write them up.",
    },
    business: {
      label: "Business operations",
      line: "Contracts, accounts, customer mail",
      prompt: "Handle contract reviews, monthly reconciliation and customer email for me.",
    },
  },

  nav: {
    lead: "Lead",
    leadHint: "New requests and questions go to the lead",
    team: "Team",
    rules: "Rules",
    handbook: "Handbook & skills",
    review: "Review & benchmarks",
    inbox: "Inbox",
    openMenu: "Open menu",
    draft: "Has an unsent draft",
    pick: "Pick a ticket on the left.",
  },
  steps: {
    title: "Setting up",
    items: ["Look around", "Say the goal", "Answer a few questions", "Confirm the plan"],
  },

  onboarding: {
    hello:
      "Hi, I'm Emperor, the lead. From now on you only talk to me: I settle the goal with you, build the team and split the work into tickets. Day to day, only blockers and your calls reach you.",
    found: "First, a look at what you have:",
    machines: "Machines",
    models: (n: number): string => `${n} models configured, to assign by role`,
    clis: (names: string): string =>
      `Found ${names}: they could become optional outside execution channels (a direction, not built yet)`,
    ask: "What should this company do? Pick a starter, or tell me in your own words.",
    import: "Import a company template",
    imported:
      "Read roles, machines, permissions and rules from the template floe-solo.penguin-org. Go through the plan; if it looks right, create it.",
    placeholder: "Tell me what this company should do",
    placeholderLater: "Answer the card above first",
    send: "Send",
    questions: "Good. Three questions, then I'll show you a plan for the company.",
    form: {
      title: "Three questions",
      work: "Work it delivers",
      workHint: "One executor per kind of work, three at most",
      budget: "Budget cap per ticket",
      rounds: "Send-back limit",
      events: "File a ticket as soon as an issue or message arrives",
      submit: "That's it",
    },
    previewIntro:
      "From your answers, here's the plan. Change anything before you confirm; nothing starts until you do.",
    preview: {
      title: "Company plan",
      team: "Team",
      teamNote:
        "The fewest hands by default: 1 lead, 1–3 executors, 1 verifier. When work piles up I'll propose a hire.",
      work: "Work it delivers",
      flow: "State machine",
      flowNote:
        "Work that fails verification goes back to the executor on its own; only blockers and your calls reach your inbox.",
      limits: "Hard gates (held by the server)",
      budget: "Budget per ticket",
      rounds: "Send-back rounds",
      depth: (n: number): string => `Delegation at most ${n} levels deep, no loops`,
      verified: "Nothing unverified is released",
      outward: "Actions outside the company",
      triggers: "Triggers",
      eventsOn: "An event wakes the lead at once",
      eventsOff: "Only the patrol and review schedules",
      workbenches: "Workbenches",
      first: "First tickets",
      warnings: "Boundaries",
      warnToken:
        "The verifier gets its own read-only GitHub token: on a shared account GitHub won't let it approve its own pull request.",
      warnOutward:
        "Merging, publishing, sending email and large experiments all come to your inbox first. The company never runs them on its own.",
      model: "Model",
      confirm: "Confirm and create",
    },
    creating: [
      "Wrote org/README.md and org/how-we-work.md",
      "Added the members, each skill at v1",
      "Registered the state machine and the hard gates with the server",
      "Split the first tickets and assigned them",
    ],
    created:
      "The company is set up. I'll only speak up when you're needed: let time pass and watch the tickets move.",
    enter: "Go to the inbox",
    answered: "Answered",
  },

  lead: {
    title: "Lead",
    intro:
      "Tell me about anything new. I'll show you a draft ticket first and file it only when you confirm. There is no all-hands chat: hand-offs between executors happen on tickets.",
    suggestions: "Try",
    placeholder: "Describe a new request",
    send: "Send",
    previewTitle: "Draft ticket",
    owner: "Executor",
    verifier: "Verifier",
    workbench: "Workbench",
    limits: "Budget / rounds",
    outward: "Outward action",
    none: "None",
    confirm: "File it",
    filed: "Filed",
    open: "Open the ticket",
    yours: "I'll file it as a document ticket, as you described it.",
  },

  ticket: {
    owner: "Executor",
    verifier: "Verifier",
    source: "Source",
    budget: "Budget",
    rounds: "Send-backs",
    roundsOf: (used: number, limit: number): string => `${used} of ${limit}`,
    spentOf: (spent: string, budget: string): string => `${spent} of ${budget}`,
    tabs: { record: "Ticket", workbench: "Workbench", runs: "Runs" },
    returned: (n: number): string => (n === 1 ? "Sent back once" : `Sent back ${n} times`),
    dropped: "This ticket was stopped.",
    goal: "Goal",
    criteria: "Acceptance criteria",
    review: "Review",
    reviewEmpty: "No review comments yet.",
    round: (n: number): string => `Round ${n}`,
    verifierSays: "Verifier",
    youSaid: "You",
    onParagraph: (n: number): string => `Paragraph ${n}`,
    decisions: "Decisions",
    decisionsEmpty: "No calls made yet.",
    result: "Result",
    resultPending: "Not delivered yet.",
    filedToHandbook: "Written to the handbook",
  },

  decision: {
    ask: (option: string): string => `Answered: ${option}`,
    halt: {
      more: "Raised the limit",
      decide: "Took the call",
      stop: "Stopped",
    },
    accept: "Accepted",
    acceptWith: (action: string): string => `Accepted and approved: ${action}`,
    sendBack: "Sent back",
    proposalYes: "Accepted the proposal",
    proposalNo: "Declined the proposal",
    drop: "Stopped the ticket",
  },

  needs: {
    askTitle: "Blocked: your call",
    askField: "Your decision",
    noteField: "A note (optional)",
    notePlaceholder: "Leave empty to go with the option alone",
    fileField: "Write it into the handbook for next time",
    submit: "Submit to the ticket",
    haltBudgetTitle: "Budget breaker",
    haltBudget: (spent: string, next: string, budget: string): string =>
      `${spent} spent; the next step would cost about ${next} and go over this ticket's ${budget}. The server stopped it.`,
    haltRoundsTitle: "Round breaker",
    haltRounds: (limit: number): string =>
      `The verifier wanted another send-back, past the limit of ${limit} rounds. The server stopped it; nothing ran.`,
    disagreement: "Where they disagree",
    moreBudget: (budget: string): string => `Raise the budget to ${budget}`,
    moreRound: "Allow one more round",
    decide: "I'll decide",
    stop: "Stop",
    decideTitle: "Verified, waiting for you",
    decideLine:
      "The verifier passed it against the acceptance criteria. Look it over in the workbench, then decide.",
    openWorkbench: "Open the workbench",
    approve: {
      merge: "Approve and merge",
      publish: "Approve and publish",
      reply: "All sent, close it",
      email: "Review and send",
      experiment: "Review and start",
    },
    acceptOnly: "Accept",
    reviewCheck: "I've read what goes out, what it costs and whom it binds",
    draftLine:
      "Drafts never go out on their own. Open a prefilled draft on its site, edit it and send it yourself.",
    sendBack: "Send back",
    sendBackPlaceholder: "Say what to change; this becomes a lesson for the executor",
    sendBackSubmit: "Send back",
    cancel: "Cancel",
    proposalTitle: "The lead proposes",
    adopt: "Accept",
    decline: "Decline",
  },

  workbench: {
    empty:
      "Nothing delivered yet: work shows up here once the executor delivers it and the verifier passes it.",
    verifiedBy: "Passed by the verifier",
    notVerified: "Not verified yet; not ready for review",
    code: {
      pr: (n: number, branch: string): string => `PR #${n} · ${branch}`,
      checks: "Checks",
      checkCi: "CI green (macOS / Windows / Linux)",
      checkTests: "New tests failed first, then passed",
      checkVerifier: "Re-run by the verifier on its read-only token",
      newFile: "New file",
    },
    experiment: {
      chart: "Evaluation accuracy by prompt round",
      round: "Round",
      accuracy: "Accuracy",
      current: "Current model",
      candidate: "Candidate: overall",
      longDocs: "Candidate: long documents",
      metric: "Metric",
      currentModel: "Current",
      candidateModel: "Candidate",
      overall: "Overall accuracy",
      long: "Long-document accuracy",
      cost: "Per 1,000 calls",
      reproduced:
        "The verifier reproduced it with other random seeds; the results agree within 0.3 points.",
      interim: (n: number) =>
        `Interim results: the first ${n} rounds are in; nothing has gone to the verifier yet.`,
    },
    document: {
      version: "Version",
      comments: "Comments",
      resolved: "Resolved in the next version",
      comment: "Comment",
      commentPlaceholder: "Say what this paragraph needs; submitting sends the work back",
      commentSubmit: "Comment and send back",
      revised: "Revised after your comment",
      generic: [
        "A first draft as you described it: background, approach, conclusion.",
        "Every quotation carries its source, and every figure was checked against the original data.",
        "The verifier went through it paragraph by paragraph against the acceptance criteria; nothing is open.",
      ],
    },
    ledger: {
      item: "Item",
      text: "Text",
      risk: "Risk",
      note: "Note",
      risks: { ok: "Fine", watch: "Watch", block: "Must change" },
      draft: "Proposed changes by email",
      to: "To",
      subject: "Subject",
    },
    outreach: {
      open: "Open prefilled",
      opened: "Opened",
      original: "Post",
      reply: "Draft reply",
      email: "Draft email",
      to: "To",
      subject: "Subject",
      toast: (where: string): string =>
        `In the prototype only: this opens the reply box on ${where}, filled in, for you to edit and send`,
    },
  },

  runs: {
    bill: "Bill",
    who: "Member",
    step: "Step",
    model: "Model",
    tokens: "Tokens",
    cache: "Cache hits",
    cost: "Cost",
    total: "Total",
    empty: "No runs yet.",
    steps: {
      work: "Work",
      deliver: "Deliver",
      fail: "Verify · back",
      pass: "Verify · pass",
      ask: "Ask",
    },
    log: "Execution log",
    logMeta: (n: number): string => `${n} tool calls · folded`,
    logLine: (step: string, tools: number): string => `${step}: ${tools} tool calls`,
    logNote:
      "Every tool call is in the Trace; the ticket itself keeps only the request, the review and the result.",
  },

  team: {
    title: "Team",
    info: "Each member is a role, a machine, a model and permissions. Export the whole set as a company template, and import it on another machine or from someone else.",
    export: "Export template",
    exported: "Exported floe-studio.penguin-org (roles, machines, permissions and rules)",
    import: "Import template",
    imported:
      "In the prototype only: an import shows a list of differences and replaces nothing until you confirm",
    machine: "Machine",
    model: "Model",
    perms: "Permissions",
    skill: (v: number): string => `Skill v${v}`,
    metrics: (first: number, verified: number, rework: number, cost: string): string =>
      `First pass ${first}/${verified} · ${rework} reworks · ${cost} a ticket`,
    noMetrics: "No verified tickets yet",
    channel: "Runs on PenguinHarness's own toolchain",
    channelNote:
      "A direction: let a role run through an outside CLI such as Claude Code or Codex where it does better. Today only the use-claude-code plugin drives Claude Code, over SSH.",
    spent: (usd: string): string => `${usd} this month`,
  },

  rules: {
    title: "Rules",
    info: "These rules live in org/how-we-work.md and the server enforces them; every change goes into its history.",
    flow: "State machine",
    flowNote:
      "Each status has one holder. Work that fails verification goes back to the executor; only blockers, breakers and your calls reach the inbox.",
    gates: "Hard gates",
    budget: "Budget per ticket",
    rounds: "Send-back rounds",
    depth: (n: number): string => `Delegation at most ${n} levels deep; the server refuses loops`,
    verified: "Nothing reaches your inbox for acceptance before an independent check",
    outward: "Outward actions by grade",
    outwardNote:
      "Anything that leaves the company comes to your inbox first. The grade says how you approve it.",
    triggers: "Triggers",
    triggersNote:
      "An event wakes the lead to file a ticket at once, without waiting for the patrol. The patrol and the review run on schedule.",
    notNow: "What it won't do",
    notNowItems: [
      "No all-hands chat: members hand work over on tickets.",
      "No org chart for show: no CEO, HR or VPs.",
      "No black box: models, skills, permissions and runs are files in the Project.",
    ],
  },

  handbook: {
    title: "Handbook & skills",
    info: "Your calls, the lessons from send-backs and each member's own skill are local files. Every change is snapshotted first and can be rolled back.",
    decisions: "Calls",
    decisionsEmpty:
      "Tick “Write it into the handbook” on a decision card and the call shows up here.",
    lessons: "Lessons",
    lessonsEmpty: "Each send-back, by the verifier or by you, becomes a lesson.",
    skills: "Member skills",
    current: "In use",
    snapshot: "Snapshot",
    rollback: "Roll back to this",
    forward: "Switch to this",
    base: "First version",
    files: "Files",
    from: (title: string): string => `From: ${title}`,
    lessonBy: (who: string): string => `Added to ${who}'s skill`,
  },

  review: {
    title: "Review & benchmarks",
    info: "The inner loop: the lead reviews first-pass rate, rework and cost per ticket, and proposes changes. The outer loop: compare against other company templates on a public benchmark.",
    inner: "Inner loop · local review",
    run: "Review now",
    last: (n: number): string => `${n} reviews so far · runs every Friday`,
    member: "Member",
    firstPass: "First pass",
    rework: "Reworks",
    perTicket: "Cost a ticket",
    proposals: "The lead's proposals",
    proposalsEmpty: "No new proposal this time.",
    outer: "Outer loop · community benchmark",
    outerNote:
      "Built on the open evaluations of the Shared RSI Community (club.penguin.ooo): typical team deliveries as a public benchmark, where templates, collaboration rules and model mixes are scored together. The figures below are illustrative.",
    template: "Template",
    staffing: "Staffing",
    models: "Models",
    score: "Score",
    yours: "Your company",
    submit: "Submit an anonymous run",
    submitted: "Submitted; waiting for the community's next run",
    rows: [
      {
        template: "Open-source upkeep · lean",
        staffing: "1 + 2 + 1",
        models: "GLM-5.3 / MiniMax M3",
        firstPass: "71%",
        perTicket: "$1.40",
        score: "82.4",
      },
      {
        template: "Research pipeline",
        staffing: "1 + 3 + 1",
        models: "Qwen3.8 Max / DeepSeek V4 Pro",
        firstPass: "64%",
        perTicket: "$3.10",
        score: "79.0",
      },
      {
        template: "Big-company org chart",
        staffing: "1 + 8 + 2",
        models: "Mixed",
        firstPass: "58%",
        perTicket: "$6.80",
        score: "70.3",
      },
    ],
  },

  tour: {
    open: (done: number, total: number): string => `Things to try ${done}/${total}`,
    title: "Things to try",
    onboarding: "Setting up",
    daily: "Day to day",
    items: {
      pick: "Pick a starter card, or say the goal yourself",
      answer: "Answer the three questions in the A2UI form",
      edit: "Change one thing in the plan (work, model or a gate)",
      create: "Click “Confirm and create”",
      ask: "Answer a blocker's decision card (the summary evaluation)",
      accept: "Look over a delivery in its workbench and accept it",
      outward: "Approve an outward action, or open a prefilled draft",
      halt: "Handle a breaker (the reseller terms or the invoice check)",
      autoReturn: "Let time pass and watch the verifier send work back",
      sendBack: "Send work back from a workbench, or comment on a paragraph",
      event: "Let time pass and watch a GitHub issue file a ticket",
      trace: "Open “Runs” for the bill and the folded execution log",
      request: "Ask the lead for something new and file it",
      rollback: "Roll a member's skill back one version in the handbook",
      review: "Click “Review now” and read the lead's proposal",
    },
    restart: "Start over",
    switchTo: { onboarding: "Try setting up", daily: "Go to day to day" },
  },

  pass: {
    hint: "No agent runs in the prototype. Each click moves every ticket one step.",
    button: "Let time pass",
    nothing: "Nothing can move: everything left waits on you.",
    events: {
      arrived: (title: string): string => `New event, the lead filed: ${title}`,
      delivered: (title: string): string => `Delivered, now with the verifier: ${title}`,
      returned: (title: string): string => `Failed verification, sent back: ${title}`,
      passed: (title: string): string => `Verified, waiting for you: ${title}`,
      asked: (title: string): string => `Blocked, waiting for your answer: ${title}`,
      halted: (title: string): string => `Breaker tripped, your call: ${title}`,
    },
  },

  money: (usd: number): string => `$${usd.toFixed(2)}`,
  tokens: (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`,

  tickets: {
    exportFix: {
      title: "Garbled Chinese file names on Markdown export (#198)",
      goal: "A user reports that exporting a note with a Chinese title produces a garbled .md file name. Fix the encoding of the export path and add tests.",
      criteria: [
        "Exported file names match the title on macOS, Windows and Linux",
        "New unit tests cover Chinese, Japanese and emoji titles",
        "The exported content itself is unchanged",
      ],
      findings: [
        "Windows hands over the NFD form, so characters like “é” still come apart. Normalize to NFC everywhere, and replace characters Windows refuses.",
      ],
      lessons: [
        "Normalize file names to Unicode NFC first, and run the tests on a Windows path separately.",
      ],
      result:
        "File names are NFC-normalized before export and illegal characters are replaced. CI is green on all three platforms, with 5 new unit tests.",
    },
    evalSummary: {
      title: "Evaluate an open model for summaries",
      goal: "Summaries cost $1.84 per 1,000 calls today. Find out whether DeepSeek V4 Flash can take over within 1 point of quality.",
      criteria: [
        "Compare accuracy on the 400-item labelled set",
        "Report long documents (over 8,000 words) separately",
        "Give the cost per 1,000 calls",
      ],
      ask: {
        question:
          "The candidate is 3 points behind on long documents and the prompt is still being tuned. How should we confirm?",
        context: "The first two rounds ran on a 100-item sample.",
        options: {
          subset: {
            label: "Long documents only",
            description: "About $1.20, within this ticket's budget",
          },
          full: {
            label: "The full evaluation",
            description: "About $18, over budget: a large experiment",
          },
          stop: { label: "Stop, keep what we have", description: "Close this ticket" },
        },
      },
      result:
        "After 6 rounds of prompt tuning the candidate scores 80.6 overall, 0.6 behind the current model, and 77.9 on long documents. Cost per 1,000 calls falls from $1.84 to $0.31.",
    },
    releasePost: {
      title: "The v2.0 release post",
      goal: "Write the v2.0 release post: sync across devices, offline mode and the new plugin interface.",
      criteria: [
        "Each new feature with something you can follow",
        "Every link opens, and versions match the release notes",
        "Under 1,500 words",
      ],
      findings: [
        "Paragraph 3 says sync is “fully real-time”; it actually merges every 5 seconds. The plugin docs link in paragraph 4 doesn't open.",
      ],
      lessons: [
        "Check feature behaviour against the code and the release notes before describing it; open every link.",
      ],
      result:
        "The second version corrects the sync description and the plugin docs link; 1,120 words.",
    },
    resellerTerms: {
      title: "Review the reseller agreement (Beichen Software)",
      goal: "Beichen Software wants to resell Floe Pro and sent an agreement. Mark the risky clauses and draft our proposed changes.",
      criteria: [
        "Each risky clause with its text, the risk and a fix",
        "Liability, data and termination always covered",
        "Changes ready to send back",
      ],
      findings: [
        "Clause 7 has unlimited liability, and the proposed changes miss it.",
        "Clause 9 asks us to hand user data to the reseller, against our privacy policy.",
        "Clause 7: the executor caps liability at 12 months of fees; I think the cap should be the fees paid. We still disagree.",
      ],
      lessons: [
        "Review a contract against the liability, data and termination checklist before anything else.",
        "For any clause about user data, read the privacy policy's own words first.",
        "When a liability cap can be written two common ways, list both and leave the call to a person.",
      ],
      result:
        "4 of 9 clauses marked as risks and the email with our changes drafted. On clause 7's cap the executor and the verifier disagree.",
    },
    replies: {
      title: "Reply to 3 help requests in the community",
      goal: "The daily patrol found 3 posts asking for help with Floe on X, the forum and Reddit. Draft a reply for each, suited to its author. Send nothing.",
      criteria: [
        "Solve the problem first, then link",
        "Reply in the post's language",
        "Nothing goes out on its own",
      ],
      result: "3 draft replies ready.",
    },
    lintRule: {
      title: "Proposal: the engineer runs lint and the affected tests before delivering",
      goal: "Last week 2 of the engineer's tickets were sent back for formatting and skipped tests, about $0.60 each time. Proposal: add “run pnpm lint and the affected tests before delivering” to the engineer's skill.",
      criteria: [
        "Added to Gentoo's skill, snapshotted first",
        "Compare the first-pass rate at next week's review",
      ],
      result: "Added to the engineer's skill.",
    },
    syncDup: {
      title: "Notes occasionally duplicated on sync (#212)",
      goal: "Two devices edit the same note offline; back online, it sometimes shows up twice. Find out why and fix it.",
      criteria: [
        "A failing test that reproduces it every time",
        "Conflicts still keep both versions to choose from",
        "Normal sync no slower",
      ],
      findings: [
        "The fix covers two devices only; three editing at once still duplicate, and the test only covers two.",
      ],
      lessons: ["Test concurrency fixes with N devices, not just two."],
      result:
        "Merges by note id and keeps both sides of a conflict through resolve; the three-device concurrency test passes.",
    },
    apiDocs: {
      title: "Document the plugin API",
      goal: "5 of the plugin interface's 12 methods have no docs. Add signatures, parameters and examples.",
      criteria: ["Signature, parameters and return value for all 5", "A runnable example for each"],
      result: "All 5 methods documented, each with a runnable example.",
    },
    invoices: {
      title: "Reconcile November's invoices with revenue",
      goal: "Match November's Stripe revenue against the invoices issued and mark what doesn't match.",
      criteria: ["Amount and date matched line by line", "A reason and a fix for each mismatch"],
      result:
        "214 charges checked, 3 mismatches: 2 refunds without a credit note, 1 charge invoiced twice.",
    },
    ciCache: {
      title: "CI cache misses double the build time",
      goal: "CI builds went from 6 to 14 minutes. Find out why the cache stopped hitting.",
      criteria: ["Builds back under 7 minutes", "Each cache's key explained"],
      findings: [
        "Only the pnpm cache was fixed; the Playwright browser cache's key carries the date and expires every day.",
      ],
      lessons: [
        "Before changing cache keys, list every cache and check that no key holds something that changes daily.",
      ],
      result: "Builds are back to 6 minutes.",
    },
    guide: {
      title: "Write a getting-started guide",
      goal: "A one-page guide for someone opening Floe for the first time.",
      criteria: ["Readable in five minutes", "A screenshot for every step"],
      result: "The guide is published.",
      ruled: "Docs for users speak to “you”, in short sentences, without marketing talk.",
    },
    discount: {
      title: "Estimate a 20% discount on yearly plans",
      goal: "Estimate what a 20% discount on yearly plans would do to revenue.",
      criteria: ["Revenue under three scenarios"],
      result: "",
      ruled: "No price cuts: yearly plans keep their price and get 2 extra months instead.",
    },
    installWin: {
      title: "Install fails on Windows (#215)",
      goal: "A user installing 2.0 on Windows 11 gets “VCRUNTIME140.dll is missing”.",
      criteria: ["Installs on a clean Windows 11 VM", "Installer at most 1.2× its old size"],
      result: "The installer checks for the VC++ runtime and installs it silently.",
    },
    proInquiry: {
      title: "Reply to a Pro yearly pricing inquiry (Northwind)",
      goal: "A customer asks about yearly Pro pricing for a 10-person team and how invoicing works. Draft a reply; send nothing.",
      criteria: ["Prices match the pricing page", "Invoicing and payment terms explained"],
      result: "Reply drafted, quoting the pricing page and explaining VAT invoices.",
    },
    pricing: {
      title: "Compare three competitors' pricing",
      goal: "Research the pricing and team-plan terms of three similar notes apps and write a one-page comparison.",
      criteria: [
        "Each price with its source and the date it was read",
        "Team-plan seat thresholds listed",
      ],
      result: "The comparison is written; every price carries its source and date.",
    },
    tutorial: {
      title: "Write a plugin tutorial",
      goal: "A first plugin tutorial: build a command that inserts today's date, from scratch.",
      criteria: ["Running within 15 minutes of following it", "Code on the 2.0 API"],
      findings: [
        "The sample code uses the 1.x API; in 2.0 registerCommand was renamed commands.add.",
      ],
      lessons: ["Run sample code on the current version before writing it up."],
      result: "The tutorial is written and its code checked on 2.0.",
    },
    cheaperModel: {
      title: "Proposal: move ledger checks to DeepSeek V4 Flash",
      goal: "King's ledger tickets average $1.90 each, and eight tenths of that goes to line-by-line matching that needs no strong reasoning. Proposal: run this work on DeepSeek V4 Flash, about $0.50 a ticket.",
      criteria: [
        "Change King's model only",
        "Compare the first-pass rate at the next review, and switch back if it drops",
      ],
      result: "King now runs on DeepSeek V4 Flash.",
    },
  },

  docs: {
    releasePost: {
      versions: [
        [
          "Floe 2.0 is out. It took four months, and it finishes the three things you asked for most: sync across devices, an offline mode, and a new plugin interface.",
          "Sync across devices: a note you take on your phone is waiting on your computer. When both sides change the same note, Floe keeps both versions and lets you choose.",
          "Sync is fully real-time: every change appears on all your devices at once.",
          "Plugins: write them in TypeScript to read and write notes and add commands. Docs at floe.dev/plugins/v2.",
          "To upgrade, click “Check for updates” in Settings; your data moves over on its own.",
        ],
        [
          "Floe 2.0 is out. It took four months, and it finishes the three things you asked for most: sync across devices, an offline mode, and a new plugin interface.",
          "Sync across devices: a note you take on your phone is waiting on your computer. When both sides change the same note, Floe keeps both versions and lets you choose.",
          "Changes are merged and pushed to your other devices within 5 seconds; changes made offline follow once you're back online.",
          "Plugins: write them in TypeScript to read and write notes and add commands. Docs at floe.dev/docs/plugins.",
          "To upgrade, click “Check for updates” in Settings; your data moves over on its own.",
        ],
      ],
      comments: [
        {
          version: 1,
          paragraph: 2,
          text: "Not “fully real-time”: the code merges every 5 seconds.",
        },
        {
          version: 1,
          paragraph: 3,
          text: "This link doesn't open; the docs are at floe.dev/docs/plugins.",
        },
      ],
    },
  },

  ledger: {
    resellerTerms: [
      {
        item: "Clause 3 · Territory",
        text: "Exclusive reseller for Greater China for 3 years.",
        risk: "watch",
        note: "Long for exclusivity: 1 year, with a sales threshold.",
      },
      {
        item: "Clause 7 · Liability",
        text: "We bear all losses caused by product defects.",
        risk: "block",
        note: "No cap. Executor: 12 months of fees; verifier: the fees paid.",
      },
      {
        item: "Clause 9 · User data",
        text: "We provide end-user data to the reseller.",
        risk: "block",
        note: "Against our privacy policy; remove it.",
      },
      {
        item: "Clause 12 · Termination",
        text: "Either party may end it with 30 days' written notice.",
        risk: "ok",
        note: "",
      },
      {
        item: "Clause 15 · Pricing",
        text: "We raise prices by at most 5% a year.",
        risk: "ok",
        note: "",
      },
    ],
    invoices: [
      {
        item: "ch_3P…a91",
        text: "Nov 4 · $96.00 · refunded",
        risk: "block",
        note: "Refunded without a credit note; issue one.",
      },
      { item: "ch_3P…c07", text: "Nov 12 · $240.00 · refunded", risk: "block", note: "As above." },
      {
        item: "in_1Q…f3e",
        text: "Nov 19 · $48.00 · invoiced twice",
        risk: "watch",
        note: "Two invoices for one charge; void the second.",
      },
      { item: "The other 211", text: "Amounts and dates match", risk: "ok", note: "" },
    ],
  },

  mail: {
    resellerTerms: {
      subject: "Our changes to the reseller agreement",
      body: "Hello Mr. Wang,\n\nWe've read the agreement and it works for us, with four changes: clause 3's exclusivity to 1 year with a sales threshold; a cap on clause 7's liability; clause 9 removed; the rest as written. The revised draft is attached.\n\nFloe Studio",
    },
    proInquiry: {
      subject: "Re: Floe Pro yearly pricing",
      body: "Hi Lena,\n\nPro for a team of 10 is $8 per person per month; paid yearly that's $960, two months less than paying monthly. We issue VAT invoices, sent within 3 working days of payment.\n\nHappy to start you on a 14-day trial first.\n\nFloe Studio",
    },
  },

  drafts: {
    replies: [
      {
        where: "X",
        author: "@mika_notes",
        post: "Floe 同步老是卡在 99%，有人遇到吗？",
        draft:
          "卡在 99% 多半是有一个超大附件。2.0 里可以在 设置 → 同步 里跳过 50MB 以上的附件。还不行的话发一下日志，我们看看。",
      },
      {
        where: "Forum",
        author: "kenji",
        post: "Is there a way to export all notes at once?",
        draft: "Yes: File → Export → All notes. Since 2.0 it keeps your folder structure, too.",
      },
      {
        where: "Reddit",
        author: "u/quietdesk",
        post: "Floe vs. a wiki for a five-person team?",
        draft:
          "For five people, Floe's shared folders cover most of what a wiki does, and notes work offline. If you need page-level permissions, a wiki is still the better fit.",
      },
    ],
  },
};
