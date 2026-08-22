# The two interviewer portraits

Sara and Ahmed are the faces of the product's one paid screen. They currently
ship as **placeholders** — a lit studio backdrop with a soft silhouette, which
reads as "portrait pending" rather than as a badly drawn person. Replace them
with generated photographic portraits and the call screen stops looking like a
demo.

## Where the files go

```
mobile/assets/interviewers/sara.png     ← the female interviewer
mobile/assets/interviewers/ahmed.png    ← the male interviewer
```

Overwrite in place and rebuild. Nothing else changes: `interviewerPersona.ts`
`require()`s these two paths, and both the setup picker and the call stage read
them through the same `<Image>`, so a file swap updates every surface at once.

## Specification

| | |
|---|---|
| Size | **768 × 768** minimum, square, 1:1 |
| Format | PNG (or a JPEG re-saved as PNG — no alpha needed, the tile clips it) |
| Framing | **Head and shoulders**, eyes on the upper third, a little room above the head |
| Crop safety | The call stage crops to a 4:5 rectangle and the picker to a circle. Keep the face inside the **middle 70%** or the picker will cut the chin. |
| Weight | Under ~250 KB each. Two of these live in the APK. |

## The prompts

### Sara — the female interviewer

```
Photorealistic corporate headshot of a professional Egyptian woman in her early
thirties, HR manager. Warm brown eyes, dark hair neatly styled, subtle natural
make-up, calm confident closed-mouth smile, looking directly at the camera.
Wearing a smart navy blazer over a light blouse. Head and shoulders, centred,
shot on an 85mm lens at f/2.0, soft studio key light from the left with a gentle
fill, shallow depth of field. Clean, softly blurred deep blue office background.
Neutral colour grading, natural skin texture, sharp focus on the eyes.
Square 1:1 composition.
```

### Ahmed — the male interviewer

```
Photorealistic corporate headshot of a professional Egyptian man in his
mid-thirties, HR manager. Short dark hair, neatly trimmed beard, friendly
composed expression, looking directly at the camera. Wearing a charcoal suit
jacket over a white shirt, no tie. Head and shoulders, centred, shot on an 85mm
lens at f/2.0, soft studio key light from the left with a gentle fill, shallow
depth of field. Clean, softly blurred deep blue office background. Neutral
colour grading, natural skin texture, sharp focus on the eyes.
Square 1:1 composition.
```

### Negative prompt

```
cartoon, illustration, 3d render, anime, cgi, plastic skin, over-smoothed,
airbrushed, heavy make-up, dramatic lighting, harsh shadows, colour cast,
sunglasses, hat, headphones, hands, text, watermark, logo, border, frame,
collage, multiple people, full body, extreme close-up, cropped forehead,
distorted features, extra fingers, asymmetric eyes
```

## Rules that are not stylistic

**Generate them; do not use a photograph of a real person.** A stock or scraped
photo of a real human presented as the app's interviewer is a likeness-rights
problem and a misrepresentation, whatever the licence says about the pixels.
Both faces must be synthetic.

**Keep the two consistent.** Same lens, same lighting direction, same backdrop
family, same crop. They appear side by side in the picker, and two portraits shot
differently look like two different products.

**Match the backdrops to the ring colours.** `PERSONA[gender].color` in
`mobile/src/screens/interviewerPersona.ts` is the tile fill behind the portrait
and the ring around it. It is currently sampled from the placeholder backdrops
(`#3A4A78` / `#2E4E80`). If the new portraits sit on a different blue, sample the
new one and update those two hex values, or the ring will not match the image it
is drawn around.

**Say they are AI.** The app already labels the interviewer as an AI, and the
privacy policy says answers go to AI providers. A photorealistic face makes that
labelling more important, not less — do not remove it from the call screen or
the store listing to make the illusion stronger.
