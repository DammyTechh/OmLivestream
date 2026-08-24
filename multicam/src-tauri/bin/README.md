# Bundled binaries

Place platform `ffmpeg` builds here before packaging:

```
bin/ffmpeg          # macOS, Linux
bin/ffmpeg.exe      # Windows
```

Bundling rather than requiring an install is deliberate — most church and
school AV machines are locked down, and asking a volunteer to install a
command-line tool on Sunday morning is how a product goes unused.

Get static builds from https://ffmpeg.org/download.html
(the LGPL build is sufficient; it includes libx264 and aac).
