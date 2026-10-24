#!/bin/bash
# What each deployed agent's record says it runs, beside what its harness's own
# log says it ran, and when. Run as root on the fleet host.
#
#   sudo bash /opt/fleet/check-models.sh
#
# Written 2026-09-10. The first multi-agent run failed partly because the model
# on a deploy record was a claim that nothing on the host applied: the brain
# exported one provider's key and passed no model at all, so every agent ran
# its harness's default. The record is a claim; the harness's log is evidence,
# and this puts them side by side.
#
# OpenCode makes two kinds of call: the primary one that does the work, and a
# small one for its own bookkeeping (session titles). Both spend and only the
# primary is the model the owner chose, so they are reported apart. Reading
# only the last line of the log reports the small model and looks like a
# mismatch that is not one.
#
# "ran" is the last primary call in the log, with its date. Evidence older than
# the day the model was set proves nothing about what runs now, so the date is
# printed rather than hidden behind a verdict.
python3 - <<'PY'
import json, os, re
agents = json.load(open('/opt/fleet/deploymgr-agents.json'))
STREAM = re.compile(r'timestamp=(\S{10})\S* .*?message=stream providerID=(\S+) modelID=(\S+).*? small=(\S+)')
for a in sorted(agents, key=lambda x: x['name']):
    n = a['name']
    log = f"/home/{n}/.local/share/opencode/log/opencode.log"
    primary, when, small = "no log", "", "no log"
    if os.path.exists(log):
        primary, small = "none seen", "none seen"
        for ts, prov, mid, sm in STREAM.findall(open(log, errors='ignore').read()):
            if sm == 'false':
                primary, when = f"{prov}/{mid}", ts
            else:
                small = f"{prov}/{mid}"
    brain = f"/opt/fleet/brains/{n}.sh"
    flag = "none"
    if os.path.exists(brain):
        m = re.search(r'--model (\S+)', open(brain).read())
        flag = m.group(1) if m else "none"
    rec = a.get('model') or 'none'
    set_at = (a.get('model_set_at') or a.get('updated_at') or a.get('deployed_at') or '')[:10]
    if rec == 'none' or rec != flag:
        verdict = "CHECK: the record and the brain disagree"
    elif primary.split('/')[-1] != rec.split('/')[-1]:
        verdict = "CHECK: the log shows another model"
    elif when and set_at and when < set_at:
        verdict = f"stale: no call since the model was set on {set_at}"
    else:
        verdict = "ok"
    print(f"{n:<20} record={rec:<26} brain={flag:<26} ran={primary:<26} on={when or '-':<12} small={small:<28} {verdict}")
PY
