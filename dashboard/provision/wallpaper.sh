#!/bin/bash
# A face for the machine: a folded mark, and the machine's own name under it.
#
# WHY A WALLPAPER IS AN INSTRUMENT HERE. openbox draws nothing, so a session is a
# black rectangle — indistinguishable from a machine that has not started X, one
# that has crashed, and a screenshot taken too early. All three were mistaken for
# each other in this project, by the tool, in one evening. A screenshot of a
# runner should say which runner it is a picture of, in letters that survive
# being scaled down, which is how screenshots are usually read.
#
# FOLDED PAPER, because that is what the project is named after: git and origami.
# It is drawn as flat polygons — four triangles meeting at a centre, each a
# different opacity of one colour, which is what reads as a fold. No asset, no
# font needed for the mark itself, so the picture still means something on a
# machine where the fonts did not install.
#
# EACH MACHINE GETS ITS OWN COLOUR, chosen from its name. Two runners side by
# side are then told apart at a glance and in a thumbnail, before any text is
# readable at all — which is the whole job a logo does.
#
# MADE ON THE MACHINE, never fetched. Nothing in this project downloads assets at
# run time, and a wallpaper that has to be served is missing on the day the
# dashboard is not answering.
#
# Its own file rather than more of desktop.sh: this is the one part of a desktop
# that is a matter of taste, and taste is the thing somebody will want to change
# without reading anything else.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the dashboard.

set -u

OUT=/usr/share/backgrounds/gitogomi.png

if [ "${OKC_DESKTOP:-yes}" != yes ]; then
  say 'this machine has no display, so there is nothing to put a wallpaper on'
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
if ! command -v convert >/dev/null 2>&1; then
  apt-get -o DPkg::Lock::Timeout=600 install -y imagemagick feh fonts-dejavu-core >/dev/null 2>&1 || true
fi
if ! command -v convert >/dev/null 2>&1; then
  say 'WARNING: no imagemagick, so this machine keeps a plain black desktop'
  exit 0
fi

install -d -m 0755 /usr/share/backgrounds

# The colour comes from the NAME, so it is the same every time this machine is
# rebuilt and different from the machine beside it. Six that all hold up on near
# black.
sum=0
for (( i=0; i<${#OKC_VM}; i++ )); do
  printf -v ch '%d' "'${OKC_VM:$i:1}"
  sum=$(( sum + ch ))
done
case $(( sum % 6 )) in
  0) ACCENT='#58a6ff' ;;   # blue, the dashboard's own
  1) ACCENT='#3fb950' ;;   # green
  2) ACCENT='#d29922' ;;   # amber
  3) ACCENT='#bc8cff' ;;   # violet
  4) ACCENT='#39c5cf' ;;   # cyan
  *) ACCENT='#f78166' ;;   # coral
esac

# THE CAT, as a paper model is actually folded: one square, a few creases, and
# every face the same sheet at a different angle to the light. That is why each
# triangle is the SAME colour at a different opacity rather than a different
# colour — it is one piece of paper, not a mosaic.
#
# IT WAS A FOX FIRST, and the difference is worth writing down because it is
# entirely in the proportions. A long triangular head that narrows to a point,
# with tall ears at the outside corners, is a fox every time. A cat is BROAD
# ACROSS THE CHEEKS, has a short blunt chin rather than a muzzle, and its ears
# sit inboard of the corners and are shorter than the face is wide.
#
# So the head is a hexagon: wide at the temples, wider at the cheeks, and cut off
# flat at the chin. Head 740..1180 across, 330..620 down, centred on 960 of a
# 1920x1080 screen. Written out rather than computed, because a wallpaper that
# fails to draw is worse than one that is off-centre on an unusual screen — feh
# scales it.
FOLD="fill-opacity 0.95 polygon 755,335 830,185 925,335
      fill-opacity 0.70 polygon 1165,335 1090,185 995,335
      fill-opacity 0.55 polygon 790,330 833,235 890,330
      fill-opacity 0.40 polygon 1130,330 1087,235 1030,330
      fill-opacity 0.88 polygon 740,330 960,330 960,620 905,618 795,515
      fill-opacity 0.62 polygon 1180,330 960,330 960,620 1015,618 1125,515
      fill-opacity 0.30 polygon 890,505 1030,505 960,585"

# The creases: down the nose, and the two that stand the ears away from the head.
# A shade lighter than the paper, which is what stops the whole thing reading as
# a flat silhouette.
CREASE="stroke-width 2 stroke #e6edf3 stroke-opacity 0.28 line 960,330 960,620
        stroke-width 2 stroke #e6edf3 stroke-opacity 0.18 line 830,185 925,335
        stroke-width 2 stroke #e6edf3 stroke-opacity 0.18 line 1090,185 995,335"

# The eyes are CUT OUT rather than drawn on: the background colour, in the shape
# a fold would leave. Slanted, and set wide — the slant is most of what says cat
# rather than kitten, and the width is most of what says cat rather than fox.
EYES="fill #05080c fill-opacity 1
      polygon 838,412 908,402 898,448 846,452
      polygon 1082,412 1012,402 1022,448 1074,452
      polygon 935,508 985,508 960,540"

# WHISKERS, asked for and worth having: they are the one part nobody mistakes.
# Drawn rather than folded, which is honest — a paper cat has them inked on too.
WHISKERS="stroke #e6edf3 stroke-opacity 0.45 stroke-width 3 fill none
          line 900,520 700,494
          line 900,534 688,540
          line 900,548 706,588
          line 1020,520 1220,494
          line 1020,534 1232,540
          line 1020,548 1214,588"

convert -size 1920x1080 radial-gradient:'#131c26'-'#05080c' \
  -fill "$ACCENT" -stroke none -draw "$FOLD" \
  -stroke none -draw "$EYES" \
  -fill none -draw "$CREASE" \
  -fill none -draw "$WHISKERS" \
  -gravity center \
  -font DejaVu-Sans-Mono -pointsize 88 -fill '#e6edf3' -annotate +0+330 "$OKC_VM" \
  -font DejaVu-Sans -pointsize 30 -fill '#5b6672' -annotate +0+400 'gitogomi' \
  "$OUT" 2>/dev/null \
|| convert -size 1920x1080 radial-gradient:'#131c26'-'#05080c' \
     -fill "$ACCENT" -stroke none -draw "$FOLD" \
     -stroke none -draw "$EYES" \
     -fill none -draw "$WHISKERS" \
     "$OUT" 2>/dev/null \
|| convert -size 1920x1080 xc:'#05080c' "$OUT" 2>/dev/null \
|| true

if [ ! -s "$OUT" ]; then
  say 'WARNING: the wallpaper could not be drawn — the desktop stays black'
  exit 0
fi

# SET BY THE SESSION, EVERY SESSION. A wallpaper set once by hand is gone the
# next time the machine boots; openbox has no notion of one, so the session says
# it. feh writes ~/.fehbg and the autostart calls it.
install -d -m 0755 "/home/$OKC_USER/.config/openbox"
if ! grep -q 'gitogomi.png' "/home/$OKC_USER/.config/openbox/autostart" 2>/dev/null; then
  cat >> "/home/$OKC_USER/.config/openbox/autostart" <<AUTOSTART

# Written by the dashboard. The background is how a screenshot of this machine
# says which machine it is.
feh --no-fehbg --bg-scale $OUT || xsetroot -solid '#05080c'
AUTOSTART
fi
chown -R "$OKC_USER:$OKC_USER" "/home/$OKC_USER/.config"

say "wallpaper drawn for $OKC_VM in $ACCENT"
