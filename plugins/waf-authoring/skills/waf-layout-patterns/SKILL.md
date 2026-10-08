---
name: waf-layout-patterns
description: Use when reading or editing the on-screen layout of an existing WAF activity module, especially one built on src/sequence.js. Catalogues how the real modules position, show and hide, clean up, highlight, layer and animate elements, and says which newer rule wins where an old pattern conflicts with it.
---

# WAF Layout Patterns

How WAF activity modules lay out assets on screen: positioning, showing and hiding, cleanup, highlighting, interaction wiring and animation. Every pattern here is taken from a real module, so it tells you what you will find when you open one, and how to change it without breaking the conventions around it.

This is a reference for the existing corpus, not a style guide for new work. Almost every authored module is on the sequence path (`src/sequence.js` with `view` from `waf-sequence`), which is what these examples use.

## When Another Skill Disagrees

Some of these modules predate the rules in the other WAF skills. When you write or rewrite code, the newer rule wins:

- **Sizing and placement:** `waf-style-guardrails` wins. Do not copy a fixed-size root (`vt1soundsinorder`) or large `rem` coordinates into new work, and place hotspots that must line up with artwork inside the media plane, never against the stage. Keep an existing module's coordinates only while you are making a small edit that does not touch its layout.
- **Element ids:** `waf-element-ids` wins. The examples below create elements from markup with no `id`; anything you create or touch gets a stable id.
- **Input:** `waf-sequence-implementation-patterns` wins. A prose tap is `CLICK`, a hold is `SELECT`. Every `inputManager.lock()` has a visible unlock before the learner is expected to act.

## Root Module Structure

Every module starts with a single root `<div>` in `res/layout.html` that acts as the container for all dynamically created elements.

### Minimal Layout (Most Modules)

Most modules use a single empty div. All content is created dynamically in JavaScript:

```html
<!-- waf-module-vt1amphibians/res/layout.html -->
<div id="module-vt1amphibians"></div>
```

### Pre-structured Layout (Puzzle Module)

The puzzle module pre-declares structural slots in HTML for the three piece locations and the board:

```html
<!-- waf-module-puzzle/res/layout.html -->
<div id="module-puzzle">
    <div id="pieces-overlay"></div>
    <div id="pieces-column">
        <div id="locationOne" class="piece-location"></div>
        <div id="locationTwo" class="piece-location"></div>
        <div id="locationThree" class="piece-location"></div>
    </div>
    <div id="board-column"></div>
</div>
```

### Root Element CSS

```css
/* Absolute fill: used by most modules, and the one to use */
#module-vt1amphibians {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
}

/* Fixed size: vt1soundsinorder. Legacy; do not copy (see waf-style-guardrails) */
#module-vt1soundsinorder {
    --module-width: 14.400rem;
    --module-height: 10.035rem;
    width: var(--module-width);
    height: var(--module-height);
}

/* Relative with flex: puzzle */
#module-puzzle {
    position: relative;
    height: 100%;
    display: flex;
}
```

### Root Initialization

In the `initialize` step, modules bind the root element using `$()` (from `waf-utils`) and store it in `view.elements`:

```javascript
function initialize({ data, next }) {
    Object.assign(view.elements, { root: $('#module-vt1amphibians') });
    // ... initialize shared data ...
    next();
}
```

## Positioning Patterns

### Pattern 1: CSS-Defined Positions (Static Layout)

The module creates a container with a known class, renders children into it, and the stylesheet handles all positioning:

```css
#module-vt1scienceassessment .choiceContainer {
    display: flex;
    justify-content: space-between;
    width: 93%;
    position: absolute;
    left: 0.5rem;
    top: 4rem;
}
```

```javascript
// vt1scienceassessment: renderChoices
const choiceContainer = htmlToElement('<div class="choiceContainer"></div>');
view.render('root', { choiceContainer });
view.render('choiceContainer', {
    choiceItems: items.map(({ interactable: { element } }) => element),
});
```

**Used in:** `vt1scienceassessment`, `vt1soundsinorder`, `vt1amphibians` (containers), `puzzle`.

### Pattern 2: Configuration-Driven Inline Positions (Dynamic Layout)

Positions come from the activity's `configurations/*.json`. The `css()` helper from `waf-utils` turns an object into a CSS string for the `style` attribute:

```javascript
// vt1amphibians: renderChoices
const {
    configuration: {
        questions: {
            [title]: { positions, mouthPosition }
        }
    }
} = data;

const element = htmlToElement(
    `<div class="choiceItem" style="position:absolute;${css(positions[i].css)}"></div>`
);
const mouth = htmlToElement(
    `<div class="mouth" style="position:absolute;${css(mouthPosition)}"></div>`
);
```

```json
{
    "positions": [
        { "item": "newt", "css": { "left": "3.1591rem", "top": "2.6136rem", "width": "8.6818rem", "height": "5.5455rem" } },
        { "item": "racoon", "css": { "left": "6.8409rem", "top": "2.3864rem", "width": "7.7273rem", "height": "6.25rem" } }
    ]
}
```

When you edit one of these, change the configuration, not the code: the positions belong to the content. New placements over artwork go in the media plane, in percentages of it.

**Used in:** `vt1amphibians`, `vt1insideoutsidebetweenep`.

### Pattern 3: Theme-Driven Positions

Some modules keep positions in the theme's `properties` rather than the configuration, read through `data.theme[key]`:

```javascript
// vt1amphibians: outro scene
const choiceItem = createImageChoiceItem({
    assets,
    item: image,
    position: theme[`${image}OutroPosition`],
});

// vt1insideoutsidebetweenep: bug positions
const { theme: { bugs } } = data;
Object.entries(bugs).reduce((acc, [name, { offset, size }]) => {
    const element = htmlToElement(`<div class="bug" style="${css(size)}"></div>`);
    // ...
});
```

**Used in:** `vt1amphibians` (outro), `vt1insideoutsidebetweenep`.

### Pattern 4: Asset-Driven Sizing

Elements are sized to their image asset's natural dimensions. A loaded asset has `.width` and `.height` from its `HTMLImageElement`, and `convertPxToRem()` translates them into the activity's `rem` coordinate system:

```javascript
// vt1scienceassessment: question frame matches its image
const element = htmlToElement(`<div class="question">${text}</div>`);
setStyle(element, {
    width: convertPxToRem(question.width),
    height: convertPxToRem(question.height),
});
setBackground(element, question);
```

**Used in:** `vt1scienceassessment`, and any module calling `convertPxToRem`.

### Pattern 5: Flex Column Layout

```css
#pieces-column {
    flex: 25%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}
#board-column {
    flex: 75%;
    height: 100%;
    display: flex;
    align-items: center;
}
.puzzlePiece {
    position: absolute;
    transition: left 0.7s cubic-bezier(0.43, 0.06, 0.22, 1.2),
                top 0.7s cubic-bezier(0.43, 0.06, 0.22, 1.2),
                width 0.7s cubic-bezier(0.43, 0.06, 0.22, 1.2),
                height 0.7s cubic-bezier(0.43, 0.06, 0.22, 1.2);
}
```

**Used in:** `puzzle`.

### Pattern 6: Runtime Repositioning with `setStyle()`

```javascript
// vt1insideoutsidebetweenep: moving bugs
setStyle(element, {
    transform: `translate(${currentOffsetX}px, ${currentOffsetY}px)`,
});

// vt1amphibians: dragging
setStyle(element, {
    zIndex: 10,
    transform: `translate(${x}px, ${y}px)`,
});
```

Move with `transform`, not by rewriting `left`/`top`: it keeps the element's layout box, and with it the coordinates of its siblings, where they were.

**Used in:** `vt1insideoutsidebetweenep`, `vt1amphibians`, `puzzle`.

### Pattern 7: Animated Position Transitions

```javascript
// vt1amphibians: moveToSpotWithTransition
function moveToSpotWithTransition(element, left, top) {
    return new Promise((resolve) => {
        element.addEventListener('transitionend', function handler() {
            element.removeEventListener('transitionend', handler);
            resolve();
        });
        setStyle(element, {
            transition: 'transform 1s ease-in-out',
            transform: `translate(${left}, ${top})`,
        });
    });
}

// puzzle: CSS transition with a timer fallback
_animatePieceTo(puzzlePiece, targetLocation, onComplete, placed) {
    let pieceElement = puzzlePiece.element;
    // ... calculate target bounds ...
    pieceElement.addEventListener('transitionend', onTransitionEnd);
    requestAnimationFrame(() => {
        pieceElement.style.left = `${nextLeft}px`;
        pieceElement.style.top = `${nextTop}px`;
    });
    setTimeout(completeTransition, 900);  // in case transitionend never fires
}
```

Any wait on `transitionend` needs a timer fallback like the puzzle's. A transition that does not run (same value, element hidden, reduced motion) never fires the event, and the sequence hangs.

**Used in:** `puzzle`, `vt1amphibians`.

## Showing and Hiding Elements

### `show()` and `hide()` from waf-utils

The primary visibility toggle. `hide()` sets `visibility: hidden` and `show()` removes it:

```javascript
import { show, hide } from 'waf-utils';

hide(mouth);          // vt1amphibians: until the speech animation starts
show(mouth);

hide(doneButton);     // vt1amphibians: until the first drag
show(doneButton);

hide(prevBug.element);                              // vt1insideoutsidebetweenep
show(bugItems[data.currentBugName].element);
```

WAF hides with `visibility: hidden`, not `display: none`. The element keeps its layout space, so absolutely positioned siblings and anything measured against it stay where they were.

### Custom Visibility Reset

```javascript
// vt1soundsinorder
function isHidden(element) {
    return element.style.visibility === 'hidden';
}
function resetVisibility(element) {
    element.style.visibility = null;
}
```

### Opacity for a Disabled Look

```javascript
// vt1amphibians: createImageChoiceItem
disable: () => setStyle(element, { opacity: '0.5' }),
enable: () => setStyle(element, { opacity: '1' }),

// or by class
choiceItem.element.classList.add('disabled');
```

```css
#module-vt1amphibians .disabled {
    opacity: 0.5;
}
```

Dimming is only the look. Lock the element's `Interactable` as well, or the learner can still tap it.

**Used in:** `vt1amphibians`, `vt1scienceassessment`, `vt1soundsinorder`, `puzzle`.

### Video

Videos are rendered into the view and played through the standard WAF operation:

```javascript
const videoInstance = getVideoPlayOperation({
    video: videoUrl,
    poster: introPoster,
    channel: 'vocals',
});

videoInstance.videoElement.setAttribute('playsinline', '');
videoInstance.videoElement.setAttribute('preload', 'auto');
view.render('root', { video: videoInstance.videoElement });
await waitForVideoReady(videoInstance.videoElement);
await videoInstance.playAsync();
```

`waf-video-patterns` owns the details: the startup cover image, mounting the opening video through `beforeHydrate`, and reusing that operation instead of creating a second video element.

**Used in:** `vt1letterpictures`.

## Cleanup and DOM Removal

### `view.remove()` and `view.removeAsMiddleware()`

`view` from `waf-sequence` tracks every element rendered under a name, and removes it by that name. `removeAsMiddleware` returns a sequence step that does the removal, which is how loops clear one item before rendering the next:

```javascript
// vt1scienceassessment
export default new Sequence([
    // ... setup ...
    [
        playQuestion,
        timeoutSubscribe,
        waitingForInput,
        timeoutUnsubscribe,
        submitSimpleChoiceResponse,
        awaitAssessmentItemOrComplete,
        view.removeAsMiddleware('choiceItems', 'question'),   // cleanup
        exitIfCompleted,
        renderQuestion,                                       // next item
        renderChoices,
    ],
]);
```

```javascript
// vt1amphibians
view.removeAsMiddleware('choiceItems', 'mouth'),
view.removeAsMiddleware('senseContainer', 'cardContainer'),
view.removeAsMiddleware('dndItems', 'dragWrapper', 'dragArea'),

view.remove('video');
view.remove('animationItems', 'imageItems');
```

Every element rendered with a name has a matching removal at the scene's exit, so nothing stale survives into the next render. If you add a named render, add its name to the removal step.

**Used in:** every sequence module with a loop.

### Direct DOM Cleanup (Class-Based Modules)

```javascript
// puzzle
_cleanupBoard() {
    this.overlayElement.innerHTML = '';
    this.boardElement.innerHTML = '';
}

// printdirectionalityassessment
this.page.hide();
this.page.removeHighlightWords();
```

### Board Reset (Reusing Elements)

Some modules keep their elements across iterations and reset the content instead:

```javascript
// vt1soundsinorder
function resetBoard() {
    view.elements.choices.forEach(choiceEl => {
        resetVisibility(getContentChild(choiceEl));
    });
    view.elements.order.forEach(orderEl => {
        removeBackground(getContentChild(orderEl));
    });
}

function removeBackground(element) {
    Object.assign(element.style, {
        backgroundImage: '',
        backgroundSize: '',
    });
}
```

**Used in:** `vt1soundsinorder`.

## Highlighting and Visual Feedback

### Pattern 1: `blinkItem()` on Timeout Level 2

The standard level-2 timeout scaffold: blink the choices to draw the learner's attention. `blinkItem` takes any object with `highlight()` and `removeHighlight()`:

```javascript
import { blinkItem } from 'waf-utils';

// vt1scienceassessment
const timeoutSubscribe = handleTimeoutSubscribe(
    (level, { choices }) => level === 2 && choices && choices.forEach(blinkItem)
);

// vt1amphibians
const timeoutSubscribe = handleTimeoutSubscribe((level, data) => {
    level === 2 && Object.values(data.choiceAnimations).forEach(blinkItem);
});
```

**Used in:** `vt1scienceassessment`, `vt1amphibians`, `vt1ecosystemsinstruction1`, `vt1rhymeinstruction2`, `vt1numbercounting`, `vt1additionsentencespractice`, `vt1solidandliquidinstruction`, `vt1makeamathstory`, `vt1locationorderpracticeandassessment`, `vt1prefixesinstruction`.

### Pattern 2: Blink by Toggling Visibility

```javascript
// vt1soundsinorder
const timeoutSubscribe = handleTimeoutSubscribe(async (level) => {
    if (level !== 2) return;

    const elementsToBlink = view.elements.choices.filter(
        c => !isHidden(getContentChild(c))
    );

    for (let i = 0; i < 3; i++) {
        await sleep(500);
        elementsToBlink.forEach(el => hide(getContentChild(el)));
        await sleep(500);
        elementsToBlink.forEach(el => resetVisibility(getContentChild(el)));
    }
});
```

Prefer `blinkItem` in new code. This loop does not stop when the learner answers mid-blink, so an element can be left hidden.

**Used in:** `vt1soundsinorder`.

### Pattern 3: Background Swap (`highlight` / `removeHighlight`)

```javascript
// vt1scienceassessment: createChoiceWrapper
function createChoiceWrapper(data) {
    const { assets: { choice, choiceHighlighted } } = data;
    const element = htmlToElement('<div class="choice"></div>');

    setStyle(element, {
        width: convertPxToRem(choiceHighlighted.width),
        height: convertPxToRem(choiceHighlighted.height),
    });

    const setBgImage = (isHighlight = false) => {
        setBackground(element, isHighlight ? choiceHighlighted : choice);
    };
    setBgImage();

    return {
        element,
        highlight: () => setBgImage(true),
        removeHighlight: setBgImage,
    };
}

interactable.onClick = async () => {
    wrapper.highlight();
    audio ? await audio.playAsync() : await sleep(400);
    wrapper.removeHighlight();
};
```

**Used in:** `vt1scienceassessment`, `vt1amphibians`.

### Pattern 4: CSS Class Toggle

```javascript
// vt1amphibians
choiceItem.element.classList.add('highlightCorrect');
choiceItem.element.classList.remove('highlightCorrect');
```

```css
#module-vt1amphibians .cardContainer .highlight {
    border-color: #783228;
}
#module-vt1amphibians .cardContainer .highlightCorrect {
    border-color: yellow;
}
```

**Used in:** `vt1amphibians`.

### Pattern 5: Text Highlighting

```javascript
// printdirectionalityassessment
async onWordTap(word) {
    word.highlightText();
    word.lock();
}

onDeleteTap() {
    this.page.removeHighlightWords();
    this.page.unlockAllWords();
}
```

**Used in:** `printdirectionalityassessment`.

### Pattern 6: Z-Index Layering

```javascript
// vt1amphibians
!isCorrect && setStyle(element, { zIndex: 4 });   // incorrect choice above correct
setStyle(element, { zIndex: 10 });                // dragged element to the front
```

```css
/* vt1insideoutsidebetweenep */
#module-vt1insideoutsidebetweenep .middle { z-index: 5; }
#module-vt1insideoutsidebetweenep .bug { z-index: 10; }
#module-vt1insideoutsidebetweenep .clickable { z-index: 15; }
```

Keep a module's stacking in one place. When a hotspot stops responding, look first for a decorative layer with a higher `z-index` sitting over it.

**Used in:** `vt1amphibians`, `vt1insideoutsidebetweenep`.

### Pattern 7: Shake on a Wrong Answer

```css
@keyframes shake {
    0%   { transform: translate(1px, 1px) rotate(0deg); }
    10%  { transform: translate(-1px, -2px) rotate(-1deg); }
    /* ... 8 more steps ... */
    100% { transform: translate(1px, -2px) rotate(-1deg); }
}

.puzzlePiece.wiggle {
    animation: shake 0.5s;
    animation-iteration-count: 1;
}
```

**Used in:** `puzzle`.

## Interaction Wiring

`waf-sequence-implementation-patterns` owns the rules for interactables and input handoff. These are the shapes you will find in the corpus.

### `SELECT` (Hold to Confirm)

```javascript
import { Interactable, inputManager, inputEventTypes } from 'input-manager-system';

const interactable = new Interactable(element, inputEventTypes.SELECT);

interactable.onSelect = async () => {
    interactable.lock();
    inputManager.lock();
    data.userAnswers.push({ id, isCorrect, score, value: value.text });
    data.pubSub.publish('activity:answerSubmitted', {
        answer: { id, isCorrect, value: value.text }
    });
    next();
};
```

**Used in:** `vt1amphibians` (assessment choices), `vt1soundsinorder`.

### `CLICK` (Instant)

```javascript
const interactable = new Interactable(element, inputEventTypes.CLICK);

interactable.onClick = async () => {
    interactable.lock();
    inputManager.lock();
    // ... handle the tap ...
};
```

**Used in:** `vt1amphibians` (intro, outro, done button), `vt1insideoutsidebetweenep`.

### `SELECT_CLICK` (Tap to Preview, Hold to Confirm)

```javascript
const interactable = new Interactable(wrapper.element, inputEventTypes.SELECT_CLICK);

interactable.onClick = async () => {
    wrapper.highlight();
    audio ? await audio.playAsync() : await sleep(400);
    wrapper.removeHighlight();
    inputManager.unlock();
};

interactable.onSelect = async () => {
    interactable.lock();
    inputManager.lock();
    await click.playAsync();
    data.userAnswers.push({ id, isCorrect, score, value: text });
    data.pubSub.publish('activity:answerSubmitted', {
        answer: { id, isCorrect, value: value.text }
    });
    next();
};
```

**Used in:** `vt1scienceassessment`.

### `DRAG` with a Drop Zone

```javascript
const interactable = new Interactable(
    element,
    inputEventTypes.DRAG,
    dropArea,       // drop zone element
    'contains'      // validation mode
);

interactable.onDragStart = () => {};

interactable.onDrag = ({ x, y }) => {
    inputManager.lock();
    setStyle(element, {
        zIndex: 10,
        transform: `translate(${x}px, ${y}px)`,
    });
};

interactable.onDragEnd = ({ isValid, reset }) => {
    reset();
    if (isValid) {
        interactable.lock();
        data.movedElements.push(Number(item));
    } else {
        setStyle(element, { transform: 'none' });   // snap back
    }
    inputManager.unlock();
};
```

**Used in:** `vt1amphibians` (hide-and-seek).

### Transparent Pixels on Sprites

Animated sprites ignore taps on their transparent pixels once this is enabled:

```javascript
// vt1amphibians: outro animals
animations.forEach(({ interactable }) =>
    interactable.enableTransparencySupport()
);
```

**Used in:** `vt1amphibians`.

### Separate Clickable Overlay

When a sprite's canvas does not take pointer events well, an invisible `div` at the same position takes them instead:

```javascript
// vt1insideoutsidebetweenep
const element = htmlToElement(`<div class="bug" style="${css(size)}"></div>`);
const clickable = htmlToElement(`<div class="clickable" style="${css(size)}"></div>`);

view.render('root', { [name]: element });
view.render('root', { [`clickable-${name}`]: clickable });

const interactable = new Interactable(clickable, inputEventTypes.CLICK);
```

```css
.clickable {
    position: absolute;
    width: 100%;
    height: 100%;
    z-index: 15;
}
```

The overlay is what the learner taps, so the overlay carries the element id, not the sprite.

**Used in:** `vt1insideoutsidebetweenep`.

## Animation Patterns

### Sprite Animations (`legacy-animation-support`)

```javascript
import Animation from 'legacy-animation-support';

const animation = new Animation({
    element: jarElement,
    sprite: assets.jar,
    animation: assets.jarAnimation,
});

await animation.goToFrame(1);
await animation.play();
```

**Used in:** `vt1amphibians`, `vt1soundsinorder`, `vt1insideoutsidebetweenep`.

### Infinite Loop

```javascript
// vt1amphibians: mouth
function playInfiniteAnimation(animation) {
    animation.enableDynamicCanvas();
    animation.play();
    animation.on(animation.event.COMPLETED, async () => {
        animation.goToFrame(0);
        await animation.play();
    });
}
```

A looping animation keeps running after its scene ends unless something stops it. Clear it in the same cleanup step that removes its element.

### Timed to Audio

```javascript
// vt1amphibians
const audioEvent = createAudioEvents(audio);
audio.play();
await audioEvent.started;

timestamps.forEach((timestamp, i) => {
    Activity.Utils.Timer.delayedCall(timestamp, () => {
        switch (i) {
            case 0: firstAnimation.play(); break;
            case 1: firstAnimation.clear(); secondAnimation.play(); break;
            case 2: show(mouth); playInfiniteAnimation(mouthInstance); break;
        }
    });
});

await audioEvent.completed;
```

**Used in:** `vt1amphibians`, `printdirectionalityassessment`.

### Background Image as the Visual

The most common way to show an image is as the element's background:

```javascript
import { setBackground } from 'waf-utils';

setBackground(view.elements.root, data.assets.background);
setBackground(choice, image);   // a URL string or a loaded asset
setBackground(element, isHighlight ? choiceHighlighted : choice);
```

**Used in:** every module.

## The `view` Registry

`view.render(parent, children)` appends named children to a parent. `parent` is a name already in `view.elements` or a DOM element. Each key of `children` becomes a name in `view.elements`, and its value is an element or an array of elements:

```javascript
view.render('root', { choicesContainer, orderContainer });
view.render('choicesContainer', { choices });
view.render('root', {
    choiceItems: items.map(({ interactable: { element } }) => element),
});

// afterwards: view.elements.choicesContainer, view.elements.choices (an array)
```

### Attaching an API to an Element

```javascript
// vt1soundsinorder
const API_FIELD = Symbol('api-field');

const el = htmlToElement(`<div class="choice"></div>`);
el[API_FIELD] = {};
Object.assign(choiceEl[API_FIELD], choice);
choiceEl[API_FIELD].value.image;
```

A `Symbol` key keeps the module's data off the element's own properties, where it could collide with the DOM's.

## Pattern Reference by Module

| Module | Root | Positioning | Highlighting | Interactions | Cleanup |
|---|---|---|---|---|---|
| **vt1scienceassessment** | Absolute fill, flex center | CSS classes, asset-driven sizing | Background swap, `blinkItem` on timeout | `SELECT_CLICK` | `view.removeAsMiddleware` |
| **vt1amphibians** | Absolute fill | Configuration inline via `css()`, theme positions for the outro | Class toggle, background swap, `blinkItem`, opacity disable | `SELECT` choices, `CLICK` intro and outro, `DRAG` | `view.removeAsMiddleware`, `view.remove` |
| **vt1soundsinorder** | Fixed size, CSS variables | CSS classes, flex containers | Visibility-toggle blink | `SELECT` | Board reset, `view.render` for the outro overlay |
| **puzzle** | Relative, flex columns | Flex columns, absolute pieces with transitions | `.wiggle` shake, placed state | SVG path hit-testing, slot-to-board animation | `innerHTML = ''` |
| **printdirectionalityassessment** | Filled by `PrintDirectionalityFactory` | Factory-managed book layout | `highlightText()`, `removeHighlightWords()` | `Interactable` on words, checkmark, delete | `page.hide()`, `removeHighlightWords()` |
| **vt1insideoutsidebetweenep** | Absolute fill | Theme positions via `css()`, `transform` movement | `blinkItem` on timeout | `CLICK` on a separate overlay | `hide()` between bugs, `view` elements |
| **lettersoundpractice2** | Class-based layout | CSS-positioned claw machine and arrows | Pressed, highlight and disabled image variants | `Interactable` on arrows and stars, claw drop | Class-managed reset |
