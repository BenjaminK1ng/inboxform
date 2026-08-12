#!/usr/bin/env bash
# Reports the AI's token spend from pi's session logs, against the $1 budget.
cd "$(dirname "$0")/.."
python3 - <<'EOF'
import json, glob, os
tot = 0.0; n = 0
for f in glob.glob(os.path.expanduser('~/.pi/agent/sessions/--home-gold-EarnLiving--/*.jsonl')):
    with open(f) as fh:
        for line in fh:
            try: o = json.loads(line)
            except: continue
            if o.get('type') == 'message':
                c = ((o.get('message') or {}).get('usage') or {}).get('cost')
                if isinstance(c, dict) and isinstance(c.get('total'), (int, float)):
                    tot += c['total']; n += 1
print(f"billed messages: {n}")
print(f"total consumed: ${tot:.4f} (of the $1.00 AI budget)")
print(f"remaining:       ${max(0.0, 1 - tot):.4f}")
EOF
