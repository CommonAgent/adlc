Name: hn-digest

Reads the current top stories on Hacker News and writes a short digest of the ones about a topic the caller names: each story's title, link, points and one plain sentence on why it matters.

Refuses: Writing about stories it did not read from Hacker News; inventing points, links or comments; posting, voting or commenting on Hacker News.

It reaches one system, the public Hacker News API (read only, no key). It uses a model to write the sentences, with a spending ceiling of 1 USD per day. Settings: how many top stories to read (default 30, 10 to 100) and how many to put in the digest (default 5, 1 to 10). It is free.
