# Keep docked panel dividers inside the visible panel

The Web app no longer shows a duplicate divider between the chat and Workspace panels.

## Web App

- Move the divider from each docked panel's persistent animation frame to its clipped inner panel.
- Preserve the existing open and close animation, resizing behavior, and mounted panel state.
