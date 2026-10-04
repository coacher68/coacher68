#!/usr/bin/env bash
# Encode rendered PNG frames to a LinkedIn-ready silent MP4 (H.264 High, BT.709, yuv420p, faststart).
set -euo pipefail
FRAMES_DIR="${1:-frames}"
OUT="${2:-../midnight-call_1920x1080_30fps.mp4}"
ffmpeg -y -hide_banner -loglevel error \
  -framerate 30 -i "${FRAMES_DIR}/f%04d.png" \
  -vf "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -tune film -x264-params aq-mode=3:aq-strength=0.9 \
  -profile:v high -level:v 4.1 -g 30 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -movflags +faststart -an \
  "${OUT}"
ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,nb_frames,color_space -show_entries format=duration,size,bit_rate -of default=nw=1 "${OUT}"
