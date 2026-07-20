# Fix the nav hover highlight sweeping in from the edge

The landing and docs navs' sliding hover pill animated from its hidden state at the nav's left edge, so the first hover sent a gray pill flying across the whole link row (and it slid back on leave).

The pill now appears IN PLACE under the first link it lands on — the position jumps with only the fade animating — slides while moving between links, and fades out where it is when the pointer leaves. Applied identically to the landing nav and the landing-parity docs nav.
