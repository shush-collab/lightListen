#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 3 — 11 new features (chapter completions, queue, bookmarks, anime continue, illustrations, cast badge, recaps, smart/bulk downloads, analytics, push)

backend:
  - task: "Chapter completion tracking (POST /api/me/chapters/{id}/complete, GET /api/me/novels/{id}/completed)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Timestamp bookmarks (POST /api/me/bookmarks with 3s dedupe, GET /api/me/novels/{id}/bookmarks, DELETE /api/me/bookmarks/{id})"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Spoiler-safe catch-up (GET /api/me/novels/{id}/catchup) — never summarises the in-progress chapter, gated by CATCHUP_MIN_DAYS=3"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Anime mappings admin CRUD (PUT /api/admin/novels/{id}/anime-mappings) + public exposure via novel_out"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Cast manifest (GET/PUT /api/admin/novels/{id}/cast) — public only exposes narration_mode + cast_count, never voice_id"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Chapter illustrations (POST/DELETE /api/admin/chapters/{id}/illustrations) + timeline-sorted public output"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Analytics events (POST /api/events) — allowlist of 10 event names, 400 on unknown, optional auth"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Push token registration (POST /api/register-push)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true
  - task: "Demo seed extras (seed_demo_extras) — recaps, illustrations, cast, anime mappings backfilled idempotently"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    needs_retesting: true

frontend:
  - task: "Novel detail: anime-continue block, cast badge, catch-up card, volume bulk-download sheet, completed chapter ticks"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/novel/[id].tsx"
    needs_retesting: true
  - task: "Player: bookmark add + bookmarks sheet, synced illustration button/modal, chapter complete on finish"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/player.tsx"
    needs_retesting: true
  - task: "Shared download queue + smart next-chapter downloads + auto-download setting in Profile"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/context/DownloadsContext.tsx, /app/frontend/app/profile.tsx"
    needs_retesting: true

metadata:
  test_sequence: 3
  run_ui: true

test_plan:
  current_focus:
    - "All 11 new feature endpoints (backend)"
    - "Novel detail + player UI for the new features (frontend web preview)"
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Fixed the only tsc error (notification handler in app/_layout.tsx) and added seed_demo_extras so the demo novel carries anime mappings, full-cast manifest, per-chapter recaps and one illustration on chapter 1. tsc + eslint are clean. Nothing else changed. Please regression-test the 11 new features end to end. Downloads are native-only: on the web preview useDownloads().supported is false, so bulk/smart download UI should degrade gracefully rather than crash."
