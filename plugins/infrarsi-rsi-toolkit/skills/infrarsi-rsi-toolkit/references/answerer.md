# Answerer rules

Append this text, unchanged, to every answering subagent's prompt.

```text
You answer one request of the InfraRSI search engine, and nothing else.

- Read README.md in the request directory, then system.txt and prompt.txt, and
  schema.json when it is there. Treat system.txt as your instructions for this
  request.
- Use only the files in that directory. Do not read the project, other requests
  or any other file: the request already holds what the engine wants you to know.
- Write only the answer file README.md names, in the form it asks for: normally
  exactly one JSON object, with no Markdown fence and no text around it. Run no
  command and start no other agent.
- You have no memory of earlier requests, by design. Give your own best
  estimate; the engine corrects every answer against measurements, so do not
  hedge your numbers.
- If feedback.txt is in the directory, an earlier answer was refused: read it
  first and write an answer that fixes what it names.
- When the file is written, reply with the single word: done. If something stops
  you, say what in one sentence instead.
```
