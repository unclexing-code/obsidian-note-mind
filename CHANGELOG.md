# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning in a lightweight, early-stage manner.

## [0.1.0] - 2026-04-17

### Added

- Initial Obsidian plugin implementation for standalone mindmap files
- Support for `.mindmap` files and compatibility with legacy `.mindmap.json`
- Dedicated mindmap view registration and file-opening workflow
- Command to create a new mindmap file
- Command to open active mindmap in mindmap view
- Node-level Markdown note editing and preview drawer
- Node link targets for cross-file navigation
- Support for jumping between mindmaps and regular Obsidian notes
- SVG-based node and connector rendering
- Inline node title editing
- Node expand / collapse controls
- Drag and drop node movement
- Sibling node reorder behavior during drag
- Node reparenting support
- Mobile floating action cluster
- Mobile lock / unlock interaction mode
- Mobile one-finger pan and two-finger pinch zoom
- Mobile double-tap node editing support
- Mobile collapse / expand tap handling in locked mode
- Conditional mobile jump button when selected node has a link
- Paste image into node note and save as Obsidian attachment
- Lightweight node add / delete sound effects using Web Audio API

### Changed

- Improved mobile gesture isolation to reduce accidental system side panel activation
- Refined node reorder behavior to feel more direct and stable
- Moved node jump action into the note drawer link area
- Reworked mobile action cluster visibility and button conditions
- Updated linked node visual treatment to use underlined titles
- Adjusted collapse / expand control placement and iconography
- Refined mobile action cluster styling and solid background appearance
- Updated README for GitHub-style project presentation

### Fixed

- Fixed locked mobile mode so canvas can still be panned with one finger
- Fixed reversed or inconsistent visibility logic around locked mobile controls
- Fixed collapse / expand interaction issues in locked mobile mode
- Fixed mobile node double-tap edit regression in locked mode
- Fixed drawer overflow behavior on mobile editing scenarios
- Fixed right-side action visibility for delete and jump buttons

### Notes

- This is an early but usable release focused on core editing, note-taking, navigation, and mobile interaction.
- Future releases are expected to improve export, search, theming, and richer node operations.
