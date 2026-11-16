/** The company-mode prototype's own words, in English, in the shape of the Chinese dictionary. */
import type { Words } from "./words";

export const en: Words = {
  nav: {
    inbox: "Inbox",
    talk: "Tell the lead…",
    talkHint: "Anything new goes to the lead; it files a ticket",
    team: "Team",
    handbook: "Handbook",
    board: "All tickets",
    record: "Record",
    sessionTab: (name: string, role: string, round: number | null) =>
      round === null ? `${name} · ${role}` : `${name} · ${role} ${round}`,
    pick: "Pick a ticket on the left.",
    notStarted:
      "The company hasn't started. Pick a workspace and what to look after, and the lead proposes a few tickets for you to decide.",
    you: "You",
    openMenu: "Open navigation",
  },
  who: (name: string, title: string) => `${name} (${title})`,
  people: {
    lead: {
      name: "Iris Vale",
      title: "Lead",
      duties:
        "Triage requests, file tickets, and dispatch work; propose schedules and staffing. Writes no code.",
    },
    engineer: {
      name: "Mara Lind",
      title: "Engineer",
      duties: "Write code and fix defects; submit pull requests with tests.",
    },
    verifier: {
      name: "Theo Park",
      title: "Verification engineer",
      duties: "Run every delivery locally before your review; reproduce reported issues.",
    },
  },
  sources: {
    person: "Your request",
    patrol: "Daily patrol",
    lead: "Lead proposal",
    retro: "Retrospective",
  },
  waits: { accept: "To accept", answer: "To answer", review: "To review" },
  roles: { build: "Build", verify: "Verify" },
  views: {
    waiting: "Waiting",
    working: "In progress",
    later: "Later",
    handled: "Handled",
    archived: "Archived",
  },
  inbox: {
    empty: {
      waiting: "Nothing waiting on you",
      working: "No tickets in progress",
      later: "No deferred tickets",
      handled: "No handled tickets yet",
      archived: "No archived tickets",
    },
    schedules: "Schedules",
    schedulesEmpty:
      "No schedules configured. Schedules proposed by the lead appear here once accepted.",
  },
  ticket: {
    needsYou: "Waiting on you",
    asks: { accept: "Approve this task?", review: "Does the delivery pass review?" },
    kindNotes: {
      task: "Accepting launches a work session to track progress; questions are raised only when blocked.",
      schedule: "Accepting enables daily patrols; detected issues are filed as tickets for review.",
      role: "Accepting adds this role to the team and ticket assignments.",
      skill:
        "Accepting installs the skill in the employee's own skills, read before similar tasks; the lessons it absorbed leave the index.",
      change:
        "Accepting applies the change as written; the employees it touches are snapshotted first, so it can be undone.",
    },
    accept: "Accept",
    reject: "Reject",
    answer: "Answer",
    recommended: (label: string) => `${label} (recommended)`,
    notePlaceholder: "Optional comments",
    approve: "Approve",
    sendBack: "Send back",
    sendBackPlaceholder: "Describe required changes before sending back",
    deliverable: "Deliverables",
    source: "Source",
    usage: (tokens: string, cost: string) => `${tokens} Tokens · ${cost}`,
    decisions: "Decisions",
    handbook: "Handbook record",
    returned: "Sent back",
    saidInSession: "You said in the session:",
    later: "Later",
    archive: "Archive",
    restore: "Restore to inbox",
    waitingFirst: "This ticket is waiting on you: act on it before deferring or archiving it.",
    saidGoal: "What you told the lead.",
    saidProgress: "Code inspection complete; starting implementation.",
    saidResult: "Work complete; submitted for review.",
    saidFound: "Did not pass verification; sent back for changes.",
    verifier: "Verifier",
    findings: "Sent back by the verifier",
    reworkProgress: "Changes applied per feedback.",
  },
  lead: {
    title: "Lead",
    info: "Permanent coordinator agent. Receives requests and files tickets for work sessions; does not write code directly.",
    placeholder: "Enter request, press Enter to send",
    send: "Send",
    acceptAll: "Accept all",
    empty: "No messages yet. Send a request to generate tickets.",
    lines: {
      proposals:
        'I\'ve read it, and written how you want the company to work to "How we work" in the handbook. Two things to start with; only what you accept starts:',
      settled:
        'All decided. From now on, only tickets that need you to accept, answer or review reach "Waiting". Nothing else interrupts you.',
      filed:
        "Ticket created and work session started. Notifications will arrive on questions or completion.",
    },
  },
  setup: {
    title: "Start a company",
    body: "Pick a workspace and the lead reads it first. Next, it suggests what the company should look after from what it read. Every step has a default, so you can go straight through.",
    workspace: "Workspace",
    workspaceInfo: "The folder the employees work in. By default, this Project's workspace.",
    read: "What the lead read",
    readInfo:
      "Once you pick a workspace, the lead reads its README, issues and CI runs. It changes no file and opens no work session.",
    mission: "What the company looks after",
    missionBody: "The lead suggests three things from what it read. You can also write your own.",
    own: "Write your own",
    ownPlaceholder: "Example: maintain the repository, find and fix defects",
    defaults:
      'Steps 3 to 5 are written to "How we work" in the handbook, which every employee reads before it starts. The company is named after the workspace folder and uses the Project\'s default model. You can change all of this later.',
    start: "Start the company",
    steps: {
      workspace: "Workspace",
      mission: "Mission",
      flow: "Tickets",
      schedules: "Schedules",
      style: "Writing",
    },
    next: "Next",
    back: "Back",
    flow: {
      title: "How a ticket goes",
      body: "A ticket passes four stops from proposal to review. You can turn off the verify stop.",
      note: "Only proposals, questions and reviews reach you. Nothing else interrupts you.",
      propose: {
        title: "Propose",
        body: "The lead files what needs doing as a ticket. It starts only when you accept it.",
      },
      work: {
        title: "Work",
        body: "An employee works in its own work session. When it is unsure, it asks you one question and waits for your answer.",
      },
      verify: {
        title: "Verify",
        label: "Verify every delivery",
        on: (name: string) =>
          `${name} runs every delivery first. If it fails, it goes back to the builder without reaching you.`,
        off: "Deliveries come straight to you for review, unverified.",
      },
      review: {
        title: "Review",
        body: "You accept it, or send it back with a note. The reason goes into the handbook, to be checked next time.",
      },
    },
    schedules: {
      title: "When the lead looks for work",
      body: "The lead looks over the workspace on a schedule, without being asked. You decide what happens to what the patrol finds.",
      patrol: "Daily patrol",
      patrolWhen: "New issues and CI, daily at 09:00",
      patrolHint: {
        off: "The lead does not look. You can turn it on later on the schedules page.",
        propose: "What it finds is filed as a ticket that waits for you to accept it.",
        auto: "What it finds starts work at once, and reaches you only for review.",
      },
      retro: "Weekly retrospective",
      retroWhen: "Mondays at 09:00",
      retroHint:
        "It looks back over last week's closed tickets and files what to change as tickets for you. It only proposes; it changes nothing itself.",
    },
    style: {
      title: "How the employees write to you",
      body: "Change an option and the sample ticket beside it is rewritten that way.",
      record: { label: "Ticket record", points: "Points", prose: "Prose" },
      ask: { label: "Questions", options: "Options and a pick", open: "Just the question" },
      progress: { label: "Progress", milestones: "Milestones", every: "Every step" },
    },
    preview: {
      title: "Preview: how a ticket will read",
      progress: "Progress",
      question: "Asks you",
      result: "Result",
      steps: [
        "Reproduced locally: 3 failures in 20 runs.",
        "Found the cause: the test's wait is too short for large exports.",
        "The wait now scales with the file size; running it 50 times in a row.",
      ],
      milestone: 1,
      ask: {
        options: "How should the wait be set?",
        open: "How would you like the wait to be set?",
        choices: ["Scale it with the file size", "Raise it to 60 seconds for all"],
        recommended: "Recommended",
      },
      points: ["The wait scales with the file size", "50 runs in a row pass"],
      prose:
        "The wait was fixed at 10 seconds, so large exports often timed out. It now scales with the file size, and 50 runs in a row pass.",
    },
  },
  workspaces: {
    harness: {
      org: "Harness Care",
      read: [
        "A pnpm monorepo: 9 packages, about 2,500 tests",
        "37 open issues on GitHub, 6 of them labelled bug",
        "2 of the last 10 CI runs failed, both on the same test",
      ],
      missions: [
        {
          label: "Maintain the repository: find and fix defects",
          why: "6 bugs have no owner, and CI is unstable",
        },
        {
          label: "Triage new issues daily and fix the clear defects",
          why: "About 10 new issues a week",
        },
        { label: "Fix the flaky test first", why: "It failed the last 2 CI runs" },
      ],
    },
    site: {
      org: "Site Care",
      read: [
        "A Vite static site: docs in English and Chinese, 86 pages",
        "12 open issues, most of them errors in the docs",
        "In the last month, the English pages changed 9 times more than the Chinese ones",
      ],
      missions: [
        {
          label: "Maintain the docs: fix errors, keep both languages in step",
          why: "The Chinese pages are 9 changes behind",
        },
        {
          label: "Read new issues daily and fix the docs errors",
          why: "Most of the 12 issues are errors",
        },
        {
          label: "Check that every page's example code runs",
          why: "3 issues are examples that fail",
        },
      ],
    },
  },
  team: {
    total: (tokens: string, cost: string) =>
      `${tokens} Tokens · ${cost} across the company this month`,
    title: "Team",
    info: "Employees are defined by name, role and duties. Only the lead runs permanently; others launch sessions per assigned ticket.",
    hire: "Hire",
    hireHint:
      "To recruit or update responsibilities, tell the lead; it files a ticket for you to decide.",
    reportsTo: (name: string) => `Reports to ${name}`,
    standing: "Permanent",
    usage: (tokens: string, cost: string) => `${tokens} Tokens · ${cost} this month`,
    working: "Active",
    idle: "No tickets in progress",
    pending: "Proposed",
    pendingNote: "Proposal in inbox; activates upon acceptance.",
    metrics: (firstPass: number, accepted: number, sendBacks: number, cost: string) =>
      `${firstPass} of ${accepted} passed first review · ${sendBacks} sent back · ${cost} per accepted ticket`,
    noMetrics: "No completed tickets yet",
    learnedTitle: "Learned on its own",
    learnedInfo:
      "When its work is sent back or you correct it, it notes that in its own notes skill, with no approval needed.",
    learned: (version: number, title: string) => `notes v${version}: from “${title}”`,
  },
  session: {
    info: "Execution log for the assigned ticket. Summary conclusions are written back to the ticket; inspect or guide progress directly here.",
    status: { running: "Running", verifying: "Verifying", ended: "Ended" },
    handoff: (name: string) => `Handed to ${name} to verify.`,
    handed: (name: string) => `Delivered by ${name}`,
    fromVerifier: (name: string) => `${name} (verifying)`,
    found: (finding: string) => `Did not pass: ${finding}`,
    verified: "Checked against each acceptance criterion; all pass. Over to you for review.",
    brief: "The lead assigned this ticket to this session.",
    answered: (label: string) => `Selected “${label}”.`,
    sentBack: (note: string) => `Sent back: ${note}`,
    noted: "Acknowledged; recorded on the ticket.",
    waitingAnswer: "Session paused until you answer.",
    waitingReview: "Execution complete; awaiting review.",
    ended: "Session ended. Final output is recorded on the ticket.",
    placeholder: "Send message directly to this session, Enter to send",
    send: "Send",
  },
  schedule: {
    info: "Schedules file tickets on a timer. The patrol can be off, propose what it finds, or start work on it; the retrospective only proposes.",
    names: {
      patrol: "Daily patrol: new issues and CI",
      retro: "Weekly retrospective: last week's closed tickets",
    },
    when: { patrol: "Daily at 09:00", retro: "Mondays at 09:00" },
    modes: { off: "Off", propose: "Propose only", auto: "Auto-start" },
    autoOn: "Auto-start",
    autoOff: "Proposal only",
  },
  pass: {
    button: "Let time pass",
    hint: "No live agents run in the prototype. Click to advance work sessions by one step.",
    nothing: "No updates: every ticket is waiting on you or done.",
    events: {
      progress: (title: string) => `“${title}” updated progress`,
      asked: (title: string) => `“${title}” has an open question`,
      delivered: (title: string) => `“${title}” ready for review`,
      proposed: (title: string) => `Patrol proposed “${title}”`,
      started: (title: string) => `Patrol started “${title}”`,
      retro: (n: string) => `Lead completed retrospective ${n}; proposals sent to inbox`,
    },
  },
  tickets: {
    csv: {
      title: "Add CSV to the export",
      gist: "The export page offers CSV as well as JSON.",
      acceptance: [
        "An export of a hundred thousand rows does not time out",
        "The JSON export is unchanged",
      ],
      progress: [
        "Analyzed export module; identified two implementation options.",
        "Implemented chosen approach; 100k rows export in 1.8s.",
        "Fixed: the output is UTF-8 with a BOM, with a test for Chinese file names.",
      ],
      found: "Exports with Chinese file names come out garbled in Excel: the CSV has no BOM.",
      question: "Large exports: stream them, or build them in one go?",
      options: [
        { label: "Stream output", hint: "Stable memory usage with additional buffering layer" },
        { label: "Batch build", hint: "Simpler implementation with timeout risk above 100k rows" },
      ],
      result: "CSV export implemented with regression tests.",
    },
    connection: {
      title: "Add a connection test to first-time setup",
      gist: "Test connectivity immediately after entering an API key.",
      acceptance: [
        "Distinct error messages for invalid keys, network failures, and missing models",
        "Test without saving credentials",
      ],
      progress: [
        "Added “Test connection” button to model dialog.",
        "Implemented error notices across all three failure modes with tests.",
      ],
      result: "Connection test implemented with explicit failure notices.",
    },
    flaky: {
      title: "Fix the flaky export test",
      gist: "Export test fails intermittently on CI: 3 failures in the last 20 runs.",
      acceptance: ["Pass 50 consecutive runs"],
      progress: ["Root cause reproduced: test timeout threshold is too short on large exports."],
      result: "Timeout scaled to export size; 50 consecutive runs passed.",
    },
    jitter: {
      title: "Reproduce the sidebar jitter on resize",
      gist: "Dragging window near 1024px width triggers repeated sidebar toggling.",
      acceptance: ["Provide reliable reproduction steps", "Identify conflicting breakpoint"],
      progress: [
        "It reproduces every time between 1020 and 1028.",
        "Two breakpoints round differently; that is the cause.",
      ],
      result: "The steps and the cause are in the report; the fix is a ticket of its own.",
    },
    types: {
      title: "Bump @types/node",
      gist: "Catch up with Node 24's types.",
      acceptance: ["The type check passes"],
      progress: ["Bumped it and changed four types."],
      result: "Bumped; the type check passes.",
    },
    docs: {
      title: "Correct the port in the quickstart",
      gist: "The docs say 7364; dev mode serves on 7365.",
      acceptance: ["Both languages are corrected"],
      progress: ["Corrected the port on the Chinese page."],
      result: "Both pages are corrected.",
      returned: "The English page still has the old port.",
    },
    timeout: {
      title: "Say so when a model request times out",
      gist: "A request with no answer after 60 seconds leaves the screen silent.",
      acceptance: ["A line and a retry button appear after the timeout"],
      progress: ["Added the line and the retry button."],
      result: "The timeout line is in.",
    },
    lint: {
      title: "Remove 12 unused imports",
      gist: "The patrol found 12 lint warnings for unused imports.",
      acceptance: ["Lint reports no warning"],
      progress: ["Removed all twelve."],
      result: "Lint reports no warning.",
    },
    survey: {
      title: "Take stock of the repository",
      gist: "Read the code, the recent issues and CI, and write one page on where it stands.",
      acceptance: ["One page at most", "The three things most worth doing first"],
      progress: [
        "Read the issues and CI runs of the last 30 days.",
        "Wrote the page, with the three things most worth doing first.",
      ],
      result: "One page on where the repository stands, in the handbook.",
    },
    patrol: {
      title: "Daily patrol: new issues and CI at 09:00",
      gist: "Each day it reads the new issues and CI results and files what it finds as tickets.",
      acceptance: ["It only proposes at first; whether to do each is yours to decide"],
      progress: [],
    },
    verifier: {
      title: "Add a dedicated verifier",
      gist: "Another agent tries every delivery by hand before it comes to you for review.",
      acceptance: ["The agent that writes the code is not the one that verifies it"],
      progress: [],
    },
    skill: {
      title: "Distill a skill: keep both languages of the docs in step",
      gist: "“Correct the port in the quickstart” was sent back once for changing one language only. Write the checks down as a skill and install it for Mara Lind.",
      acceptance: [
        "The skill says to check both languages after a change",
        "It is installed for the engineer who edits the docs",
      ],
      progress: [],
    },
    patrolScope: {
      title: "Stop the patrol proposing dependency upgrades",
      gist: "You rejected the patrol's “Bump @types/node”. From now on dependencies are upgraded only when you ask; the patrol looks at issues and CI only.",
      acceptance: ["The patrol schedule's prompt no longer checks dependencies"],
      progress: [],
    },
  },
  handbook: {
    title: "Handbook",
    info: "The company's memory: handbook/ in the organization's directory. The lead writes to it at three moments: you answer a question, and it records a decision; a delivery is sent back, and it records a lesson; the same kind of work comes up often enough, and it proposes a skill, installed for the employee who does that work once you accept. Employees read it before they start.",
    groups: {
      index: "Index",
      retro: "Retrospectives",
      decision: "Decisions",
      lesson: "Lessons",
      skill: "Skills",
      doc: "Documents",
    },
    empty: "None yet",
    from: "From ticket",
    installedOn: "Installed for",
    decisionBody: (label: string) => `Chose “${label}”.`,
    lessonTitle: (title: string) => `Sent back: ${title}`,
    lessonAfter: "Before delivering work of this kind again, check this first.",
    merged: "Merged into a skill",
    mergedNote:
      "This lesson is now part of a skill. It is out of the index, and employees read the skill instead.",
    version: (n: number) => `version ${n}`,
    retroTitle: (n: number, closed: number) => `Retrospective ${n}: ${closed} tickets`,
    retroLine: (
      closed: number,
      accepted: number,
      firstPass: number,
      sendBacks: number,
      questions: number,
      cost: string,
    ) =>
      `${closed} closed, ${accepted} of them done and ${firstPass} passed on first review; ${sendBacks} sent back; you were asked ${questions} times; ${cost} per finished ticket.`,
    retroBaseline: "This is the first retrospective; these numbers are the baseline.",
    retroBefore: (firstPass: number, accepted: number, sendBacks: number, cost: string) =>
      `Last time: ${firstPass} of ${accepted} passed on first review, ${sendBacks} sent back, ${cost} per ticket.`,
    retroEffect: (title: string, name: string, closed: number, sendBacks: number) =>
      `Since “${title}” was accepted, ${name} has closed ${closed} tickets, with ${sendBacks} sent back.`,
    retroProposals: (titles: string) =>
      `Proposed this time: ${titles}. They are in your inbox for you to decide.`,
    retroNothing: "Nothing to change this time.",
    quote: (title: string) => `“${title}”`,
    join: ", ",
    howWeWork: {
      verify: {
        on: (name: string) =>
          `${name} runs every delivery first; only one that passes comes to you for review.`,
        off: "Deliveries come straight to you for review, unverified.",
      },
      patrol: {
        off: "No daily patrol.",
        propose:
          "What the daily patrol finds is filed as a ticket that waits for you to accept it.",
        auto: "What the daily patrol finds starts work at once, and reaches you only for review.",
      },
      retro:
        "A retrospective every Monday; what it wants to change is filed as tickets for you to accept.",
      record: {
        points: "Ticket records are written as points.",
        prose: "Ticket records are written as full paragraphs.",
      },
      ask: {
        options: "A question offers two or three options and marks the recommended one.",
        open: "A question is asked on its own, with no options.",
      },
      progress: {
        milestones: "Progress is noted at milestones only.",
        every: "Progress is noted at every step.",
      },
      change:
        "To change any of this, tell the lead; the patrol can also be changed on the schedules page.",
    },
    docs: {
      howWeWork: { title: "How we work", body: [] as string[] },
      readme: {
        title: "Handbook index",
        body: [
          "This is the company's memory. Employees read it before they start.",
          "Decisions: questions you have answered. When one comes up again, it is settled here, without asking you.",
          "Lessons: deliveries that were sent back, what was missed, and how to avoid it next time.",
          "Skills: fixed ways of working distilled from lessons, installed in an employee's own skills.",
          "Documents: what tickets delivered, such as the state of the repository.",
          "Retrospectives: every Monday the lead looks back at the tickets closed the week before: how many passed on first review, how many were sent back, how often you were asked and what it cost, and proposes what to change.",
        ],
      },
      state: {
        title: "State of the repository",
        body: [
          "42 new issues in the last 30 days, 9 of them about the export.",
          "CI failures cluster in the export test: 3 of the last 20 runs, from a timeout that is too short.",
          "The three things to do first: fix the flaky export test, add a connection test to first-time setup, export CSV.",
        ],
      },
      docsLesson: {
        title: "Change both languages of a docs page",
        body: [
          "“Correct the port in the quickstart” was first delivered with the Chinese page only, and sent back.",
          "When changing a docs page, find its other language first, change both, and compare the numbers before delivering.",
        ],
      },
      bilingualSkill: {
        title: "bilingual-docs: keep both languages of the docs in step",
        body: [
          "When to use: a ticket changes any page under packages/docs.",
          "1. Find the page's two files, under zh and under en.",
          "2. Make the same change in both.",
          "3. Before delivering, compare the numbers, commands and links section by section.",
        ],
      },
    },
  },
};
