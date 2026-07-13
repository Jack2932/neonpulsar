"""Reset non-DM groups (channels) and their content.

This is intentionally a separate tool so you can wipe old groups without
rewriting code or manually digging through the database.

Usage:
  python -m neonchat.tools.reset_groups --yes

Notes:
  - Keeps DM channels by default.
  - Does not delete user accounts.
"""

from __future__ import annotations

import argparse

from sqlalchemy import delete

from neonchat.app import (
    create_app,
    db,
    Channel,
    ChannelMember,
    ChannelRead,
    Message,
    Attachment,
    MessageReceipt,
    MessageReaction,
)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--yes", action="store_true", help="actually perform deletion")
    args = p.parse_args()

    if not args.yes:
        print("Refusing to run without --yes. Nothing was deleted.")
        print("Example: python -m neonchat.tools.reset_groups --yes")
        return 2

    app = create_app()
    with app.app_context():
        chans = Channel.query.filter_by(is_dm=False).all()
        channel_ids = [c.id for c in chans]
        if not channel_ids:
            print("No non-DM groups found. Nothing to do.")
            return 0

        msg_ids = [m.id for m in Message.query.filter(Message.channel_id.in_(channel_ids)).all()]

        # Children first
        if msg_ids:
            db.session.execute(delete(Attachment).where(Attachment.message_id.in_(msg_ids)))
            db.session.execute(delete(MessageReceipt).where(MessageReceipt.message_id.in_(msg_ids)))
            db.session.execute(delete(MessageReaction).where(MessageReaction.message_id.in_(msg_ids)))
            db.session.execute(delete(Message).where(Message.id.in_(msg_ids)))

        db.session.execute(delete(ChannelRead).where(ChannelRead.channel_id.in_(channel_ids)))
        db.session.execute(delete(ChannelMember).where(ChannelMember.channel_id.in_(channel_ids)))
        db.session.execute(delete(Channel).where(Channel.id.in_(channel_ids)))

        db.session.commit()

        print(f"Deleted {len(channel_ids)} groups and {len(msg_ids)} messages.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
