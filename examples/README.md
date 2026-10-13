# Few-shot examples

One file per content type (`educational.txt`, `thread.txt`, `light_humor.txt`, `satire.txt`, `spontaneous.txt`,
`question.txt`, `hot_take.txt`, `story.txt`). Put 5-10 **real** tweets in each, the way the account actually writes.
They are added to the prompt for that type only and show tone, rhythm and length, not content.

Format:

- Examples are separated by a line holding only `---`.
- In a thread example, the parts are separated by a line holding only `+++` (the first part is the hook).
- Lines starting with `#` are comments and are ignored.
- Only the first 10 examples of a file are used. An empty file means no examples for that type.

```
# hot_take.txt
rapat satu jam yang bisa diganti satu chat itu bukan kolaborasi, itu kebiasaan
---
bangun jam 4 pagi nggak bikin produktif. tidur cukup yang bikin produktif
```

```
# thread.txt
cara milih laptop bekas tanpa kena tipu 🧵
+++
1. cek baterainya dulu
+++
2. ...
+++
intinya: jangan buru-buru
```

The files are read once per process: restart the server (or the worker) after editing.
