# SPEC — Vanishing Point App

Expo SDK 58 (expo ~58.0.26, Expo Router, react-native 0.88.1). Runs in Expo Go on iPhone.

## 1. Overview

App for finding vanishing points in a city or inside a room. It understands the horizon line and aligns lines in perspective.

## 2. Screens

### 2.1 Camera (Live)

* Shows what the camera sees, with the horizon line overlaid on top.
* The horizon is calculated using the phone's sensors and moves in real time as you tilt the device.
* Works in portrait mode only.
* There is an on-screen level to help keep the phone as horizontal as possible. It changes color and vibrates when level.
* Calibration buttons: one to reset the horizon and arrows to manually move it up or down.
* Tapping on the horizon places a "star" (vanishing point), labeled VP1, VP2, or VP3, each in a different color.
* 12 lines fan out from each star. Tapping one selects it (making it thicker); the others appear faint.
* Stars stay locked onto the horizon: if you tilt the phone, they move up or down with it.
* You can move a star by dragging it and delete it by pressing and holding it.
* If there are no stars, only the horizon is visible.
* Shutter button to take a photo. The photo is saved with the stars and lines, and opens in the editor.
* If camera permission is not granted, a message appears explaining how to enable it.
* No zoom or flash.

### 2.2 Editor (Photo)

* Add lines by dragging a finger from one point to another.
* Line thickness control.
* Line style: solid, dotted, or dashed.
* Line color, chosen from a palette.
* Vertical lines: parallel or converging to a vanishing point, depending on the perspective.
* Undo button, which deletes the last line.
* Clear all button, with confirmation.
* Already-drawn lines cannot be moved; they are corrected using undo.
* Save button, which saves the photo along with its lines to the gallery.

### 2.3 Gallery

* Photos are saved only inside the app, not in the iPhone camera roll.
* Grid of thumbnails showing the date of each photo.
* Tapping a photo opens it in the editor to continue editing.
* Delete a photo, with confirmation.
* If there are no photos, the message "No photos yet" is displayed.
* No sharing.

### 2.4 Perspective Menu

* Choose 1, 2, or 3 vanishing points, with a short explanation of each.
* The selected option defines how many stars you can place.

## 3. Navigation

* Upon opening the app, you are already on the camera screen.
* Like the native phone camera: at the bottom on one side is the thumbnail of the last photo (opens the gallery), in the center is the photo button, on the sides are the feature buttons, and in the other corner is the perspective menu.
* Gallery → tap a photo → editor.
* Every screen has a button to return to the camera.
* No initial tutorial.

## 4. Persistence

* Photos, along with each photo's lines and stars, are saved.
* The last selected perspective type and the chosen line thickness, style, and color are saved.
* Everything is still there after closing and reopening the app.

## 5. Visual Style

* Very clean, white menu.
* Underlined radioactive blue lettering.
* Avenir font or similar, mixed with a terminal-style font.
* No toggle switch to turn off vibration.

## 6. Out of Scope

* Automatic detection of buildings or lines using the camera.
* Compiling the app for the App Store.
* Measuring real-world distances.
* Landscape mode, zoom, flash, sharing, and tutorial.

## 7. Acceptance Criteria

1. Upon opening the app, the live camera appears with the horizon line overlaid on top.
2. When tilting the phone upward, the horizon moves down on the screen in real time.
3. When the phone is horizontal, the level changes color and the phone vibrates.
4. The calibration arrows move the horizon up or down, and the reset button returns it to its original position.
5. Tapping on the horizon places a star labeled VP1.
6. 12 lines extend from the star; tapping one selects it and makes it appear thicker.
7. Pressing and holding a star deletes it.
8. With "1 point" selected in the menu, a second star cannot be placed; with "2 points" selected, it can.
9. Tapping the photo button opens the editor with the photo, stars, and lines.
10. In the editor, dragging a finger draws a new line.
11. Changing the thickness, style, or color applies to the next line you draw.
12. Undo deletes the last line, and clear all asks for confirmation before deleting.
13. Tapping save adds the photo to the gallery with its date.
14. Tapping a photo in the gallery opens it in the editor with its lines.
15. Deleting a photo asks for confirmation and then no longer appears.
16. With an empty gallery, "No photos yet" is displayed.
17. When camera permission is denied, a message appears instead of a black screen.
18. If you close Expo Go completely and reopen it, the photos, their lines, and the selected options are still there.
