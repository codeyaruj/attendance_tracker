# Timetable extraction fixtures

The reference image supplied with the extraction brief was not available as a
workspace file, so it has not been recreated or approximated. Copy the original
unchanged image to:

`tests/fixtures/timetables/jss-ec3-odd-semester-2026-27.jpeg`

The conditional fixture test will then exercise structural table detection. Do
not resize or annotate the source image: coordinate-independent assertions are
intended to catch regressions across the real camera/document geometry.
