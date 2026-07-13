# Final QA checklist

## Core flows
- open a DM from the sidebar
- open a DM from the Friends page
- switch between Friends, DM and a server channel repeatedly
- verify the center panel never shows Friends and DM at the same time

## Friends
- verify Online tab only shows online users
- verify All tab shows everyone
- verify Pending tab hides the main friends list and shows pending UI only
- verify search filters the visible list only

## Composer
- verify the send button appears when text is entered
- verify reply bar appears and can be dismissed
- verify the jump-to-latest button is hidden while already at the bottom

## Emoji
- desktop: verify the bottom emoji picker opens above the composer button
- mobile: verify the emoji picker behaves like a bottom sheet

## Mobile
- verify left panel behaves like a drawer on narrow screens
- verify selecting a DM/channel closes the drawer
- verify the right profile panel behaves like a sheet on very small screens

## Production
- verify /healthz returns 200
- verify static assets are served by nginx directly
- verify only systemd -> gunicorn is used on the server
