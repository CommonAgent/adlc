Name: reference-builder.

From the ADLC One-Builder Plan, step 5: a reference builder, the plugin run headless. Its one offering takes a person's request for an agent and runs the ADLC plugin through a coding harness with no person at the keyboard: it starts a build folder with /adlc:start, then runs the plugin's check until it passes or a person is needed. At each person gate it stops, and the question is its reply; it resumes the same build with the person's answer. The person's approval is theirs: it approves the spec only when the person says approve for that build. It is a harness, not a second author: it writes nothing the plugin does not.

It refuses to write a build's files itself, and it refuses a message about a build it does not keep. When the message has no words, it asks for the request. When the harness cannot be run, it stops and says so, and writes nothing.

It reaches no system of its own. It runs one program, the coding-harness command installed on the host with the ADLC plugin, which takes a prompt and a session to resume; the model is the harness's. It is free.

## The person asked for changes (2026-11-12)

The reference builder is out of date with the ADLC plugin's two phases. Make it version 0.2.0:
1. After each run it reads the build folder's own check, which now names the phase the build is in, the spec or the build. Its reply says where the build is in those words: the spec still has things missing, the spec waits for the person's approval, the build has things missing (and how many), or the build has passed. It never says the build has passed when the check does not.
2. It offers the person the approval of the spec only when the check says the spec waits for the person.
3. Once the spec is approved, it asks the harness to carry on with the build until the check says the build has passed, not stage by stage.
4. The person's words are theirs: when it hands the harness a person's message for a build, it first adds those words to the build folder's said.md, under a heading with the time, so the check can find the words an answer quotes. The prompts it writes itself are not the person's, so it runs the harness with ADLC_NOT_THE_PERSON=1.
Everything else stays as it is.
