# Project Procedure and GitHub Upload Guide

## Overview
This repository contains the **OSM** (Open Source Mapping) project. Below is a quick guide on the overall workflow and how to add this `README.txt` (or any other file) to the remote GitHub repository.

---

## 1. Project Workflow
1. **Develop locally** – Write code, run tests, and ensure everything compiles.
2. **Commit changes** – Stage changed files with `git add <file>` and commit with a meaningful message.
3. **Synchronise with remote** – Pull remote updates, resolve any conflicts, then push your commits.

---

## 2. Adding this README to GitHub
```bash
# Ensure you are in the repository root
cd C:\DATA\PANDU\Ten\Portofolio

# 1. Stage the README file
git add README.txt

# 2. Commit with a descriptive message
git commit -m "Add project procedure README"

# 3. Pull remote changes (if any) and re‑base
git pull --rebase origin main

# 4. Push the commit to GitHub
git push -u origin main
```

> **Tip:** If the remote has diverged and you encounter a conflict, resolve the conflicted files, `git add` them, then run `git rebase --continue` before pushing again.

---

## 3. Common Git Commands
| Command | Description |
|---------|------------|
| `git status` | Shows staged/unstaged changes |
| `git diff` | View differences before committing |
| `git log --oneline` | Compact view of commit history |
| `git branch -M main` | Rename current branch to `main` |
| `git remote add origin <url>` | Link local repo to GitHub |
| `git push -f origin main` | Force push (use with caution) |

---

## 4. Additional Resources
- **GitHub Docs:** https://docs.github.com/en/repositories
- **Git Cheat Sheet:** https://education.github.com/git-cheat-sheet-education.pdf

---

*Created on 2026‑05‑23.*
