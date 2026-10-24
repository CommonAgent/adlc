# What this agent will not publish

Publishing is the act that puts something in front of people. It is the one
step of making software whose mistakes are public, and it is usually treated as
plumbing and handed to whoever happens to hold the credential. This file is the
authority for the refusals; the program follows it and nothing else decides.

## Everything is decided on the bytes

A name is what somebody typed. Bytes are what will be served. So every decision
here is made by reading the file, never by reading its name.

A file called `page.html` that is not text is refused. A file called `notes.txt`
that carries a private key is refused as a private key. A file with no extension
at all is fine, because its bytes say what it is.

The one place a name is allowed to win is where the bytes cannot be more
specific. A stylesheet, a markdown file and a CSV are all just text, and no
signature will ever tell them apart. Where the claim is compatible with the
bytes, the claim is what gets served, because a stylesheet served as plain text
is a stylesheet a browser will not apply.

## The seven refusals

**Somewhere else.** It writes under the one bucket and the one folder the host
bound at install, and it cannot be told another. A message naming a destination
is refused rather than obeyed. A name that would climb out of the folder cannot
survive being turned into a name: everything that is not a lowercase letter, a
digit or a hyphen becomes a hyphen, so a dot-dot or a slash is gone before it
reaches the host.

**Something it was not handed.** It does not fetch a file from an address in
order to publish it. If it did, anybody who could send it a message could put
anything on the internet under our name, and the fetch would be the whole
attack. What goes up is what was handed over.

**Bytes it has not read.** Every file is read and hashed before it is placed,
and the digest is in the record. A publisher that streams a file through
without looking cannot answer the only question that matters afterwards, which
is whether what is being served is what was sent.

**A file that is not what it says.** Where the bytes and the claim disagree,
the file is refused with both, and it is not served as either. Serving bytes
under a type nobody has agreed on asks a browser to guess, and a browser
guessing about content somebody uploaded is the oldest hole there is.

**A credential.** A private key, a service-account key, an AWS key, an NKey
seed. Found in the bytes, refused whatever the file is called, and refused even
where the person asked for it. This is the mistake that cannot be walked back:
an address that served a key for ten seconds served it to whoever was watching.

The list is short on purpose. A long one starts refusing ordinary work, because
a page about authentication says the word secret, and a refusal a person cannot
predict is worse than no refusal: they stop handing things over. Every entry is
a thing that is only ever a live credential.

**An address it has not read back.** After every file is placed, the address is
fetched and the bytes hashed and compared with what went up. Only then is the
address given out. An upload that returns 200 and an address that serves the
wrong thing is an ordinary afternoon with a cache in the way, and the whole
value of this step is that somebody checked.

**A name it did not place.** A name already in use by a file this agent has no
record of placing is not replaced. The reply says the name is taken and asks
for another.

## What it does not do

It does not strip, redact, shrink or rewrite anything to make it publishable. A
refused file is reported with the reason, and what to do about it is the
person's decision, not this agent's. An agent that quietly fixed a file would be
publishing something nobody had approved.

It does not delete. Taking something down is a different act with a different
authority, and it is not this job.

It does not decide whether the work is any good. It decides whether these bytes
can safely be served at this address, which is a much smaller question, and
answering a small question completely is worth more than answering a large one
approximately.
