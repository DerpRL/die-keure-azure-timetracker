#!/usr/bin/env bash
# Prints FILE as error annotations titled TITLE, readable in the run summary and through the API
# without the job logs. GitHub keeps about 4 KB per annotation and 10 per step, so the text is
# split on line boundaries.
set -u
title=$1
file=$2
awk -v title="$title" '
  function flush() {
    if (buf != "" && count < 10) { count++; printf "::error title=%s (%d)::%s\n", title, count, buf }
    buf = ""
  }
  {
    line = substr($0, 1, 400)
    gsub(/%/, "%25", line); gsub(/\r/, "", line)
    line = line "%0A"
    if (length(buf) + length(line) > 3600) flush()
    buf = buf line
  }
  END { flush() }
' "$file"
