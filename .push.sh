#!/bin/bash
cd /root/freellmapikey-src
TOKEN=$(cat /root/.picoclaw/workspace/.git-token)
git remote set-url origin "https://ghp:${TOKEN}@github.com/FTsong/FreeLLMAPIKey.git"
git push origin master
