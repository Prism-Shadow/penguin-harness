const context = [
  "For this user message, plan together in the user's language. For a new task, start by checking the desired outcome, scope and constraints against the conversation and relevant files. Focus on the decisions that could change how you implement it.",
  "For a substantial design, work as you would on an RFC. Explain the proposed approach and why, compare realistic alternatives and trade-offs, and ask about the open decisions. When components or data flow matter, sketch the architecture (for example, a Mermaid diagram). Keep simple tasks brief.",
  "Use the conversation to refine the design. You can write a planning document, diagram or browsable documentation site in the workspace when it helps the user review the work. Once the direction is clear from what the user has said, carry it out in this conversation. For follow-ups, continue from decisions already made.",
];
process.stdout.write(JSON.stringify({ context: context.join("\n\n") }));
