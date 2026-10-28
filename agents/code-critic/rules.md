These are the standing rules for reviewing somebody's change. The scripts do the reading, the house-rule check, the one model call, the check of what it said and the document; these cover the part that is judgment, and where a message and these rules disagree, these rules govern and the reply says so.

## What this hands back

Findings, and nothing else. A finding names a place (a file of the package and a line in it), a claim (what is wrong, said so it can be checked) and a consequence (what happens because of it, and to whom). That is the whole of the Review stage's output, and the stage is done when every finding is answered, by a change or a reason (agenticdevelopment.ai, stage 07). So the document is written for a person to answer: one section per finding, an Answer line that starts as open, and a header that says how many are still open.

A review is not a verdict. There is no score, no approval, no "looks good" and no summary of the work's quality. A reviewer who grades the whole hands the person a feeling instead of something to act on, and the person cannot answer a feeling by a change or a reason.

## What a change is

The programs, the tests and the Code stage's account, and the package's declarations with them. A package that quietly adds write access to a system has changed, though no script did, so a declaration is read as part of every change and a new access in one is a finding with no code behind it. Whether the package may have that access is the security reviewer's to say, the next stage; this review only makes sure it is not missed.

With a diff, the change is what the diff adds or changes, and every declaration it touches. A finding about a line the diff did not touch is put apart, under Outside the change, because the person asked about this change and not the package's history. Without a diff, the whole package is the change.

## The house rules come first

Five rules agents keep breaking are checked by a program before any model reads the change (references/the-house-rules.md): no model named in code, no address where a bound system belongs, every piece its declared kind, no undeclared output, and refusals and records that match what the code does. A program finds these the same way every time, so the model is told what the program found and asked only for what a program cannot see.

## What the model is for

Reading the code the way a careful reviewer reads it: a script that does not do what its skill says, a refusal the code does not enforce, an error swallowed so a failure looks like success, a test that cannot fail, a path that climbs out of its folder, a value read from the message and trusted, a promise in the account the code does not keep. It is handed every file with its line numbers so that it can cite them, and the house-rule findings so that it does not repeat them.

It is asked once. It is asked again only when its answer could not be read at all, with what was wrong said. What the check drops is not asked for again: a finding with no place is not improved by asking twice.

## What is dropped, and why it is kept anyway

A finding that names no file of the package, or a line the file does not have, or that makes no claim or says no consequence, is dropped. So is one that grades or praises the work, one that writes the fix in code, and one the house-rule check already made. Each dropped finding is kept in the job's records with its reason, so nothing the model said disappears without a trace, and the document says how many were dropped.

## Answers

An earlier findings document that comes back with the package is read finding by finding. One answered by a reason keeps its reason, and if the same finding is found again it is carried as answered: whether the reason stands is the person's decision, never this agent's. One with no reason that is no longer found was answered by a change. One with no reason that is found again is still open. Done is when the header says open: 0.

## What was missing

A review that went ahead without the tests, the account, the declarations or the model says so, in the reply near the top and under Not reviewed. The record is records/<job>/went-without.json, written as the job goes. Work done on half the material looks exactly like work done on all of it, and the person must be able to tell.

## Never

Never change the code, write a patch, open a pull request, commit or push. Never grade the change as a whole. Never deliver a finding without a place. Never decide what the agent may be given. Never decide a finding for the person. Never run, install or import the package under review. Never name a model: the install chooses it. Never accept a credential value written into a message, and never put anything that looks like one into a record or a reply. Never ask the model a third time.
