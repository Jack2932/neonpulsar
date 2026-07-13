# NeonChat staged rebuild plan

## Stage A — core communication
- stabilize Friends vs DM center view
- stabilize online/all/pending filtering
- keep sidebar Friends/search visible outside server mode
- dock bottom emoji picker to composer button

## Stage B — composer and messages
- jump-to-latest button
- reply/edit/actions
- attachments and GIF/stickers

## Stage C — UI polish
- unify cards, shadows, spacing, hover states
- improve emoji panel visuals
- improve sounds and feedback

## Stage D — mobile
- one-screen mobile flow
- drawers/sheets for side panels
- mobile-safe composer and picker

## Stage E — production
- finalize systemd/nginx/gunicorn
- static/media via nginx
- hosting docs and env setup


### Stage B1 shipped
- stable jump-to-latest visibility
- reply bar above composer
- send button appears when typing/uploading
- composer state sync after send and resize


### Stage C1 shipped
- unified luxe card treatment for sidebar/chat/rightbar
- polished composer, popovers and context menus
- refined jump button and emoji popup visuals
- safer visual-only pass without touching core chat logic


### Stage C2 shipped
- subtle premium press/hover states for buttons, rows and message actions
- lightweight synthesized UI click feedback without extra assets
- stronger composer focus and primary action emphasis
- safer feel-only pass that does not alter core message logic


### Stage D1 shipped
- stronger one-screen mobile flow with drawer-like sidebar/profile panels
- safer mobile composer positioning and viewport handling
- emoji popup behaves like a bottom sheet on mobile
- auto-close drawers after selecting a DM/channel and cleaner mobile state classes


### Stage D2 shipped
- stronger mobile center-state classes for Friends / DM / Guild views
- cleaner keyboard-aware composer and emoji sheet positioning via visualViewport
- safer mobile screen hiding so Friends does not bleed into DM on narrow screens
- right profile panel becomes a bottom sheet on very small screens


### Stage E1 shipped
- production deploy pack cleaned up for nginx + systemd + gunicorn
- added direct nginx static/media serving config
- added env example and production checklist
- documented one-runner rule (nginx -> gunicorn -> wsgi:app)


### Stage E2 shipped
- added `/healthz`, `/readyz` and `/api/health` readiness endpoints
- added request-id and response-time headers with slow-request logging
- added optional `DATABASE_URL` support and stronger cookie/runtime env config
- added dedicated `deploy/gunicorn.conf.py` and tightened systemd/nginx production pack


### Stage F1 shipped
- added a final consolidation pass for center-view state so Friends / DM stop bleeding into each other as often
- added safer final filter/jump-button sync after delayed DOM updates and message renders
- added a last emoji anchoring layer for desktop button-anchor and mobile bottom-sheet behavior
- kept sidebar Friends/search visibility tied to actual server mode instead of flaky transient state only


### Stage G1 shipped
- added a state-guardian pass that keeps Friends / DM / Guild center modes mutually exclusive more aggressively
- added a guarded sidebar visibility rule so Friends/search stay visible outside real server mode only
- added final jump-button and emoji-anchor resync on resize, focus, visibility and delayed DOM updates
- added a compact QA-ready stabilization layer intended for the final full-build pass
