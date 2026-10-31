#!/usr/bin/env bash
# Live probes of provider OAuth endpoints (no credentials). Usage: ./probe.sh > probes-YYYY-MM-DD.txt
probe() { # label url
  echo "=== $1"; echo "GET $2"
  curl -sS -o /tmp/probe_body -D /tmp/probe_hdr --max-time 12 -A "oauth-runway-verify/1.0" "$2" || true
  head -1 /tmp/probe_hdr; grep -i '^location:' /tmp/probe_hdr | head -1
  tr -s ' \n' ' ' < /tmp/probe_body | head -c 700; echo; echo
}
R=https://example.com/callback
probe "Google OIDC discovery" "https://accounts.google.com/.well-known/openid-configuration"
probe "Google authorize, dummy client" "https://accounts.google.com/o/oauth2/v2/auth?client_id=dummy.apps.googleusercontent.com&response_type=code&redirect_uri=$R&scope=https://www.googleapis.com/auth/gmail.readonly"
probe "Microsoft common OIDC discovery" "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration"
probe "Microsoft authorize, dummy client" "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=00000000-0000-0000-0000-000000000000&response_type=code&redirect_uri=$R&scope=Mail.Read"
probe "GitHub authorize, dummy client" "https://github.com/login/oauth/authorize?client_id=dummy&redirect_uri=$R"
probe "GitHub OAuth AS metadata" "https://github.com/.well-known/oauth-authorization-server"
probe "Slack OIDC discovery" "https://slack.com/.well-known/openid-configuration"
probe "Slack authorize v2, dummy client" "https://slack.com/oauth/v2/authorize?client_id=123.456&scope=chat:write&redirect_uri=$R"
probe "Notion authorize, dummy client" "https://api.notion.com/v1/oauth/authorize?client_id=dummy&response_type=code&owner=user&redirect_uri=$R"
probe "HubSpot authorize, dummy client" "https://app.hubspot.com/oauth/authorize?client_id=dummy&scope=crm.objects.contacts.read&redirect_uri=$R"
probe "Intuit OIDC discovery (prod)" "https://developer.api.intuit.com/.well-known/openid_configuration"
probe "Intuit authorize, dummy client" "https://appcenter.intuit.com/connect/oauth2?client_id=dummy&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=$R&state=x"
probe "LinkedIn OIDC discovery" "https://www.linkedin.com/oauth/.well-known/openid-configuration"
probe "LinkedIn authorize, dummy client" "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=dummy&redirect_uri=$R&scope=openid%20profile"
