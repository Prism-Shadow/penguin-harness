# Password field polish, model-key visibility, and borderless skill cards

Several small UX fixes across the password fields, the model key input, and the skill library cards, plus a redrawn penguin game shot.

- The change-password dialog's current-password field now shows a hint naming the built-in admin's default initial password (penguin-2026), so a user who forgot it can still get in.
- The password show/hide toggle is removed from the tab order (tabIndex -1): Tab now moves between fields instead of landing on the reveal button.
- The model API key input gains the same show/hide toggle (it reuses PasswordInput), so a pasted key can be verified before saving.
- Skill library cards drop their border; hover now tints the whole card with a light gray background instead.
- The penguin sled game mockup is redrawn so the penguin stays a single connected cartoon shape (it had looked fragmented), and the game example is emphasized as 2D with a smoother, gentler difficulty ramp in the draft-screen card, its prompt, and the landing tab label.
