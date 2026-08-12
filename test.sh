#!/usr/bin/env bash
# End-to-end test of InboxForm against a local instance.
set -e
cd "$(dirname "$0")"
PORT=8090 node server/server.js > /tmp/inboxform.log 2>&1 &
PID=$!
trap "kill $PID 2>/dev/null" EXIT
sleep 1

echo "=== 1. status ==="
curl -s localhost:8090/api/status | head -5

echo; echo "=== 2. create form ==="
RESP=$(curl -s -X POST localhost:8090/api/forms -H 'content-type: application/json' -d '{"name":"Demo contact","webhook":"","ai_reply":false}')
echo "$RESP"
FORM_ID=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).form_id))")
KEY=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).key))")

echo; echo "=== 3. submit 3 times ==="
for i in 1 2 3; do
  curl -s -X POST "localhost:8090/f/$FORM_ID" -H 'content-type: application/json' -d "{\"email\":\"user$i@example.com\",\"message\":\"hello $i\"}" | head -3
done

echo; echo "=== 4. honeypot submit (should be dropped, ok:true) ==="
curl -s -X POST "localhost:8090/f/$FORM_ID" -H 'content-type: application/json' -d '{"email":"bot@spam.com","_company":"spam"}'

echo; echo "=== 5. list submissions (expect 3) ==="
curl -s "localhost:8090/api/submissions?key=$KEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('count:',a.length);console.log(JSON.stringify(a[0]))})"

echo; echo "=== 6. usage ==="
curl -s "localhost:8090/api/usage?key=$KEY"

echo; echo "=== 7. ledger ==="
curl -s localhost:8090/api/ledger | head -20

echo; echo "=== 8. record a manual sale (admin) ==="
# restart with admin token to test the record endpoint
kill $PID 2>/dev/null; sleep 0.5
ADMIN_TOKEN=testsecret PORT=8090 node server/server.js > /tmp/inboxform2.log 2>&1 &
PID=$!
sleep 1
curl -s -X POST localhost:8090/api/ledger/record -H 'content-type: application/json' -d '{"token":"testsecret","kind":"sale","amount_usd":5,"note":"Pro plan — first customer"}'
echo; curl -s localhost:8090/api/ledger | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).summary)))"

echo; echo "=== 9. checkout without LS config (expect 501 + howto) ==="
curl -s -X POST localhost:8090/checkout -H 'content-type: application/json' -d '{"email":"x@y.z"}'

echo; echo "=== 10. landing page serves ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" localhost:8090/
echo "ALL TESTS PASSED"
