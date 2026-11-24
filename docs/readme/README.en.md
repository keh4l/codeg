<h1 align="center">
  <img src="../../public/icon.svg" alt="Codeg logo" width="56" align="absmiddle" /> Codeg custom build
</h1>

<p align="center">
  <a href="https://github.com/keh4l/codeg/releases/latest"><img src="https://img.shields.io/github/v/release/keh4l/codeg?style=flat&color=e91e63" alt="Latest release" /></a>
  <a href="https://github.com/spacering-net/codeg"><img src="https://img.shields.io/badge/upstream-spacering--net%2Fcodeg-24292f?style=flat" alt="Upstream" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/keh4l/codeg?style=flat" alt="License" /></a>
</p>

<p align="center">
  <sub><a href="../../README.md">简体中文</a> · <strong>English</strong> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.es.md">Español</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.pt.md">Português</a> · <a href="./README.ar.md">العربية</a></sub>
</p>

<p align="center">
  <strong>xintaofei's multi-agent coding workspace <a href="https://github.com/spacering-net/codeg">Codeg</a>, customized by keh4l</strong><br/>
  Every AI coding agent in one place, working together. Follows upstream closely and adds a few features.
</p>

<h3 align="center"><a href="https://github.com/keh4l/codeg/releases/latest"><ins>Download</ins></a> · <a href="#install"><ins>Install guide</ins></a> · <a href="https://docs.codeg.app"><ins>Official docs</ins></a></h3>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/workspace-dark.png" />
    <img src="../images/workspace-light.png" alt="The Codeg workspace: a conversation with an agent beside its live diffs and the project's files" width="960" />
  </picture>
</p>

## What's different from the official build

<table>
  <tr>
    <td width="50%" valign="top">🪟 <strong>Tabs per window</strong><br/>With several windows on one server, turn tab sync off and each window keeps its own tabs; conversations and messages still sync.</td>
    <td width="50%" valign="top">🌐 <strong>Translated replies and messages</strong><br/>Each part of an agent's reply is translated into your language as soon as it is finished, thinking, question cards and todo lists too, and a message translates to English in one keystroke, via Alibaba Cloud or Tencent Cloud translation models, at about a second per 1,000 characters.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🧩 <strong>Claude Code sub-agent sessions</strong><br/>Sub-agent rows get "Open conversation", which opens the sub-agent's full conversation the way it already does for Codex; a sub-agent can be watched while it runs.</td>
    <td width="50%" valign="top">📱 <strong>Switch open conversations on a phone</strong><br/>On a phone, tap the conversation title to see every open conversation and how far each has got, then tap one to switch; the title lights up when another one is waiting for you.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🎨 <strong>Agents generate images</strong><br/>Set up the address, key and models of OpenAI, Grok, Gemini or a relay, and every agent that supports MCP can make and edit images, saved where it says; the image shows in the conversation, and the key never passes through the agent.</td>
    <td width="50%" valign="top">⏳ <strong>Results for agents with short time-outs</strong><br/>Some agents wait only 30 to 60 seconds for a tool call. This build caps each wait per agent, returns in time and collects the rest on the next call, so a slow answer to a question no longer counts as no answer.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🗂️ <strong>Only the agents you use</strong><br/>Settings lists only the agents you added; the rest wait in “Add agents”, searchable and added several at a time. A new install enables only what is installed here, so the new-conversation picker stays short.</td>
    <td width="50%" valign="top">📋 <strong>Long-press to select text on a phone</strong><br/>Long-pressing text in a reply or the message box brings up the phone's own selection handles and copy menu instead of the conversation menu; select a reply with a finger and Copy Text / Quote / Ask appear under the message box, clear of the phone's menu.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🔁 <strong>Restart the server from the web</strong><br/>Settings → System gains “Restart codeg”: codeg deployed on a server restarts without logging in to the server, and the page reconnects by itself; restoring a backup on a server now restarts to apply it, too.</td>
    <td width="50%" valign="top">⏯️ <strong>Sub-agents pick up where an error stopped them</strong><br/>When a delegated sub-agent stops because the network dropped, its quota ran out, its sign-in expired or the provider returned an error, the main agent can have it carry on in its original session, with its context and half-done work intact, instead of starting over in a new one.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🧑‍💼 <strong>Agents set up @ assistants for you</strong><br/>Say “add a reviewer assistant on Codex with high effort” in a conversation and the agent creates or changes the @ assistant: name, agent, model and standing instructions as you said, every option you didn't mention at the agent's default. Click Edit right in the conversation to adjust it.</td>
    <td width="50%" valign="top">🧭 <strong>Grouped Settings</strong><br/>The Settings nav sits under five headings; busy pages gather related options on one card, every page has a title, and on a phone a dropdown no longer squeezes its description into a sliver.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">↩️ <strong>Sub-agents wake the main agent when done</strong><br/>When a delegated sub-agent finishes, its result goes back to the main agent by itself: an idle main agent starts a new turn and carries on, a busy one gets it in the current turn, and if you are just sending a message, it goes along with that. The main agent can end its turn once it has handed out the work instead of waiting around to check for results.</td>
    <td width="50%" valign="top">🌿 <strong>Sub-agents work in their own worktree</strong><br/>The main agent can have a sub-agent change code in a separate git worktree and branch, so several working side by side stay out of each other's way; each delegation can set its own model and reasoning effort, and a sub-agent that has finished can be given more work in the same session.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🗣️ <strong>Steer while the agent works</strong><br/>While the agent replies, the send key puts your message into the running turn, and the agent reads it after the step at hand; hold ⌘/Ctrl to queue it for after the turn instead. Every agent can be steered. Queued messages live on the server, so they survive a reload and follow you to another device; a stop or an error pauses the queue until you say go.</td>
    <td width="50%" valign="top">✨ <strong>T3-style compact conversation view</strong><br/>Each reply’s work folds into a single “Worked for Xs” line, showing only the live step while running; a changed-files tree replaces artifact cards and the reply footer appears on hover. Adds four tool-visibility levels, a timeline minimap, whole-thread ⌘/Ctrl+F find, clickable backlink citations, code-block wrap &amp; “Run in terminal”, and a pure-black Carbon theme. Switch back to Timeline anytime in Settings.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🛰️ <strong>Snappy over a remote link</strong><br/>Using the web app over a public IP: about a second from reload to typing, the last round of a long conversation visible within a second, and no more “Connecting” when you switch back to a conversation you just saw. A network hiccup is caught up on its own: no reconnect notice, no lost text.</td>
    <td width="50%" valign="top">⚡ <strong>Buttons react at once, replies flow evenly</strong><br/>Approve, rename, delete, stop and steer take effect the moment you press them. A request that didn't get through is retried and never runs twice; only a real failure undoes the change, with a notice. On a slow link a reply no longer jumps in bursts but appears at a steady pace.</td>
  </tr>
  <tr>
    <td colspan="2" valign="top">🔄 <strong>Follows upstream</strong><br/>Upstream is merged in regularly; anything not listed here works exactly as in the official build. The built-in Kiro CLI, the first thing this build added, has been part of the official build since 0.36.0. Claude Code thinking summaries use the official build's switch from 0.41.3-1 on: “Show Claude's thinking summaries” in Settings → Agents → Claude Code, off by default. From 0.46.0-1 the suggested next message is filled in the official way: Tab on a computer, the lightbulb button beside Send on a phone.</td>
  </tr>
</table>

<details>
<summary><strong>Tabs per window</strong>: details</summary>
<br/>

- It's the "Sync open conversation tabs across windows" switch in Settings → General, on by default: every window and device on the server (computer, tablet, phone) shares one set of open tabs, as in the official build.
- Turned off, opening, focusing or closing a conversation tab in one window leaves the others as they were, and a reload brings back that window's own tabs.
- Conversations, messages and deletions always reach every window, whichever way it is set.
- The switch is stored on the server: flip it in any window or on any device and every window and device connected to that server switches with it. (Up to 0.35.2-1 it was kept per browser and off by default in browsers.)
- Requested upstream in [spacering-net/codeg#547](https://github.com/spacering-net/codeg/issues/547).

</details>

<details>
<summary><strong>Translated replies and messages</strong>: details</summary>
<br/>

- Turned on in Settings → Translation with an API key from [Alibaba Cloud Bailian](https://bailian.console.aliyun.com/) or [Tencent Cloud TokenHub](https://console.cloud.tencent.com/tokenhub/apikey); each platform bills its own usage. The default is Bailian's `qwen-mt-flash`, which took about 0.5 s per paragraph in testing.
- Replies: with the "Reply translation" switch on, each part of a reply is translated as soon as the agent has finished it (it moves on to a tool call or more thinking, or the turn ends), all of that part in one request so the model sees it whole, and shown in place of the original; while the agent writes you see the original. The translate button under each reply switches back to the original, or translates that one reply when automatic translation is off. Thinking is translated when you expand it (the one-line title shown even when it's folded stays as written) and follows the same button; code blocks and tool calls are not translated. The copy button copies what is on screen.
- Session names: with automatic reply translation on, the names the agent gives sessions are shown in your language too, in the sidebar, the tabs and the conversation header. A name you set yourself is left as written, and hovering a session in the sidebar shows the original.
- Question cards: when an agent asks you something, the question and its options show translated by default (switch it off in Settings → Translation), and the button at the card's top right switches between original and translation; the answer still names the agent's own option. An answer typed under "Other" translates into the target language with the button beside it or `⌘⇧L`, and the same button puts it back; with "Translate when sending" on it is translated on submit. Questions marked secret are never sent for translation.
- Todo lists: the steps of an agent's todo list (the "Updated plan" row in a reply, the floating plan over the conversation and the plan in Session Details) show translated by default, the whole list in one request (switch it off with "Translate todo lists automatically" in Settings → Translation). The button under the list once you expand that row (in its title bar, for the floating plan) switches between original and translation; with the switch off, the same button translates by hand.
- Messages: the composer's translate button, `⌘⇧L` (`Ctrl+Shift+L` on Windows and Linux) or the right-click menu translate the message box in place into the target language (English by default). Mentions, slash commands, paths and code stay as written, and `⌘Z` brings the original back in one step. Nothing is sent for translation until you ask, so a half-written draft never leaves the machine. "Translate when sending" does it on every send. Once sent, the translate button beside the message switches back to what you wrote before translating, and copying follows what is shown.
- On a rate limit it falls back to `qwen-mt-lite` or the other engine; a glossary pins down how specific terms are translated, and an entry with no translation keeps its term as written.
- API keys are kept in the OS keychain (on a server, in `tokens.json` in the data directory), never in the database; the eye button in Settings shows a saved key. Translation requests connect directly, bypassing any proxy, and go through the proxy only when the network allows nothing else.
- Reply translations are for display only: the conversation history keeps the agent's original text. What you wrote before a message was translated is kept in the local database, and clearing the translation cache leaves it alone.

</details>

<details>
<summary><strong>Claude Code sub-agent sessions</strong>: details</summary>
<br/>

- Claude Code keeps each sub-agent's (Agent / Task tool) whole conversation in a file of its own, `~/.claude/projects/<project>/<session id>/subagents/agent-<id>.jsonl`. In the official build the sub-agent's row shows only a summary of what it did and the final result (a background sub-agent's not even the summary), and that file can't be opened.
- This build adds an "Open conversation ↗" link to the sub-agent's row that opens the file in a side panel: the task the sub-agent was given, its thinking and replies, and every tool call with its input and output. It's the same entry point Codex and Grok sub-agent rows have.
- The link appears as soon as the sub-agent starts, in the foreground or the background. Opened while the sub-agent is still running, the panel refreshes every 2 seconds and shows the tool call in progress as running. Opened after the conversation is reloaded, it shows the file as it was then; close and reopen it to see the latest.
- Earlier conversations work too, as long as the sub-agent's file is still there.

</details>

<details>
<summary><strong>Switch open conversations on a phone</strong>: details</summary>
<br/>

- Below 768 px wide (a phone, or a very narrow browser window) the official build shows no conversation tab strip. Reaching another open conversation means finding it in the sidebar's full history, and a completed one, which the sidebar hides by default, can't be reached at all.
- This build turns the conversation title into a button: after the title come a ⌄ and the number of open conversations, with an amber dot on the number while another conversation waits for your approval or answer. It opens "Open conversations" from the bottom: every open conversation in tab order, each with its status (Needs you, In Progress, Review, Completed, Cancelled, Not sent). Tap one to switch to it, × to close it; you can also start a new conversation, or open the sidebar with "All conversations (incl. history)". Tap outside, drag it down or use the back gesture to close it.
- "Needs you" is only known while this device is connected to that conversation: it shows for conversations opened at least once on this device, and the others show their saved status.
- With "Sync open conversation tabs across windows" on (the default), a conversation closed on the phone closes on the computer too, just as closing its tab there would.
- At 768 px and wider (computers, tablets) nothing changes: the tab strip stays.
- A conversation opened from the sidebar starts as a preview (as on the desktop) that the next one opened replaces; here its title is in italics, and the 📌 next to it keeps it. Double-tapping it in the sidebar keeps it too, as a double click does on the desktop: on a phone the sidebar now waits a moment before closing, so the second tap lands on the same row.
- Requested in [keh4l/codeg#10](https://github.com/keh4l/codeg/issues/10), [#12](https://github.com/keh4l/codeg/issues/12).

</details>

<details>
<summary><strong>Agents generate images</strong>: details</summary>
<br/>

- In Settings → Image generation, add a service: pick OpenAI API (OpenAI itself, Grok and most relays) or Gemini API (Google itself or a relay), leave the address empty for the official one, then add the key and model names such as `gpt-image-2`, `grok-imagine-image-2.0` or `gemini-3-pro-image`. You can add several. Test generates one small, low-quality image to check it works, billed by the service.
- Once the switch at the top of the page is on (the same one as "Generate images" in Settings → Collaboration → In-conversation tools, off by default) and at least one service has a key and a model, agents started from then on get two tools, `image_generate` and `image_get_result`. An agent can pick the model, aspect ratio, resolution and a transparent background, and pass reference images to edit an existing picture; without a model it gets the default one from the settings.
- The agent decides where the image is saved; a relative path is resolved against the conversation's working folder. Without one, images go to `~/.codeg/generated-images/<date>/`, a folder you can change in the settings.
- Each image gets a card in the conversation: while it is being made, the seconds so far; then the image, where it was saved (click to open), the service and model, the size and the time taken. The image is read from the file, so after reloading the conversation it shows for as long as the file is there.
- By default the agent also gets a copy about 512 pixels wide, so it can see the result before deciding whether to change it; this uses some of its context. Turn it off in the settings if the agent's model can't read images.
- An image often takes from tens of seconds to two minutes. When that is longer than the agent can wait for one tool call, it gets a job id first and collects the image with `image_get_result`; see the next section.
- Codeg makes the call itself; the agent only gets the image file. API keys are kept in the system keychain (on the server build, in `tokens.json` in the data folder), not in the database, and are not part of config sync.

</details>

<details>
<summary><strong>Results for agents with short time-outs</strong>: details</summary>
<br/>

- How long an agent waits for one MCP tool call varies: ZCode 30 seconds; Cursor, Kimi and DeepSeek 60 seconds; Codex 5 minutes; Claude Code, OpenCode, Qoder, CodeBuddy and Grok practically without a limit. In the official build, `get_delegation_status` (waiting for a delegated task's result) can wait a long time in one call and `ask_user_question` (a question for you) waits until you answer; past the deadline the agent treats the call as failed and carries on, so the question counts as unanswered.
- This build gives these tools a cap per agent, below its deadline: for example 20 seconds on ZCode, 45 seconds on Cursor, 4 minutes on Codex; agents without a limit get no cap, as in the official build. When the cap is reached without a result, the call returns and tells the agent how to keep waiting.
- Questions: if you haven't answered by then, the question card stays where it is and the agent keeps waiting with a new tool, `get_question_answer`; once you answer, the answer shows in the original question card.
- In “N running”, each sub-agent has a “Stop” button, and the heading has “Stop all” when there are two or more. A sub-agent you stop there is not handed back to the main agent.
- Delegated tasks: one `get_delegation_status` call waits at most up to the cap, then returns the tasks' current status. With “Wake the main agent when a subagent finishes” on, the main agent usually doesn't need to wait at all, as results come back by themselves; see “Sub-agents wake the main agent when done”. Image generation works the same way; see the previous section.
- While waiting, the agent gets a progress update every 10 seconds, which lets agents that extend their deadline on progress, such as CommandCode, wait longer.

</details>

<details>
<summary><strong>Only the agents you use</strong>: details</summary>
<br/>

- There are 20 built-in agents, and the official build enables all of them, installed or not: a long settings list, a new-conversation picker crowded with agents that aren't installed (the conversation page never installs one, so picking one gets you nowhere), and an install check for every one each time the settings page opens.
- In this build, Settings → Agents lists only “My agents”, which you can still drag to reorder. “Add” in its title bar and the row below the list open “Add agents”: search by name or description, filter by installed / not installed, find the agents already installed here first, and add several at a time. One that isn't installed is installed from its details once added.
- The switch in an agent's details is “My agents”: turn it off to take the agent off the list, with undo. It is the official build's “enabled” setting, so the new-conversation picker, delegation and everything else follow it.
- Opening the settings page checks only “My agents”; any other agent is checked when you open it.
- When codeg has no settings for an agent yet (a fresh install, or a built-in added by a later release), it enables the agent only if it is detected as installed here. Codeg counts an agent as installed once the ACP adapter or CLI it runs is in place, so a fresh install often has none and the list starts empty: pick from “Add agents”. An agent you install later is not added by itself, and existing settings are never changed.
- After upgrading from an earlier build with agents in “My agents” that aren't installed, a hint at the top of the list offers once to “Keep only the installed” ones or keep things as they are (the choice is remembered per device).
- The new-conversation picker ends its row with a “+” that opens “Add agents”; when the agents don't all fit, it is at the bottom of the “more” menu instead. With no agent enabled, the picker's button opens “Add agents” too.

</details>

<details>
<summary><strong>Long-press to select text on a phone</strong>: details</summary>
<br/>

- In the official build the whole conversation area and the message box carry menus of their own, and a long press with a finger opens them too: hold a reply for about 0.7 s and the conversation menu (New Conversation, Export Conversation, …) appears; on Android the event the long press sends is cancelled as well, which cancels the phone's own word selection. Over HTTPS, a long press in the message box opens its own Cut / Copy / Select all menu. The phone's selection handles and copy menu never appear, so text in replies and in the message box is hard to copy.
- This build leaves a long press with a finger or a pen to the phone: selecting, dragging the handles, copying and pasting are the phone's own. A right click with a mouse still opens both menus, on a computer with a touch screen too.
- In the official build, the Copy Text / Quote / Ask bubble for a selected reply sits next to the selection, and so does the phone's menu, above it or below as the phone decides; a page can neither read nor move it, so the two often land on top of each other. In this build, a selection made with a finger puts these buttons and the number of characters selected under the message box, standing in for the folder and branch row until the selection goes; the phone's menu can't reach past the message box. Ask takes the question right in that row. A selection made with a mouse still gets the bubble above it.
- The message box menu's Quick messages are also under the “+” at the bottom left of the message box; translating a message has its own button.
- On iOS, the system menu for ordinary text on a web page has no Select All (only text fields do); to copy a whole reply, use the copy button under it.

</details>

<details>
<summary><strong>Restart the server from the web</strong>: details</summary>
<br/>

- Deployed on a server, the official build has no way to restart codeg from the web page: after changing a setting that needs a restart (appearance, language, provider list, browser proxy, …), or when the service misbehaves, you have to log in to the server and restart it there. Restoring a backup on a server is the same: the restore only applies after a restart, but the restart it calls only accepts a staged update, so it always ends with “the service could not restart, restart it manually”.
- This build adds “Restart codeg” under “Software Update” in Settings → System. “Restart” asks first, and the dialog says how many conversations are running and will be interrupted; after that it counts down, waits for the service to come back and reloads the page. Other open windows show “Restarting” in their status bar too.
- It restarts the way an in-place update does: under Docker or the supervisor (`--supervise`), the supervisor starts it again after `CODEG_RESTART_DELAY_MS`; run on its own, the process restarts in place (systemd and the like still see the same process). A plain restart doesn't enter the update's trial period and never triggers its automatic rollback. It can't restart while an update is downloading or installing.
- After restoring a backup on a server, “Restart now” in the result panel uses the same restart, so the restore applies by itself.
- Server builds only: not in the desktop app, nor in a browser connected to a desktop's built-in web service; like the in-place update, not on Windows servers yet.

</details>

<details>
<summary><strong>Sub-agents pick up where an error stopped them</strong>: details</summary>
<br/>

- When you @ an agent in a message, the main agent hands it the work with `delegate_to_agent`, and it works in its own sub-session. In the official build, `resume_delegation` only brings back sub-tasks that were canceled or cut off by a crash; a sub-agent whose turn ended in an error (network dropped, quota or rate limit hit, sign-in expired, the provider rejected the request, token budget used up…) is marked “failed”, and the main agent can only open a new sub-session and start over, losing the context of the half-done work.
- This build treats those failures as interruptions too: the sub-task's result says its session and partial work are kept and that `resume_delegation` continues it once the cause is fixed. The main agent then carries on in the original sub-session under the same task_id, and the sub-agent's original card in the conversation follows its progress again.
- To use it: once the network is back, the quota is topped up or you've signed in again, ask the main agent to let the sub-agent continue.
- A task that failed before it had a session (the agent couldn't start, say) has nothing to continue and needs a new delegation. To give a sub-task that has finished more work, use `continue_delegation`; see “Sub-agents work in their own worktree”.

</details>

<details>
<summary><strong>Agents set up @ assistants for you</strong>: details</summary>
<br/>

- In the official build, @ assistants (delegation presets you can @ in a message: an agent, every one of its options, and standing instructions) can only be filled in field by field under Settings → Collaboration → Multi-Agent Collaboration → Assistants; an agent can't help.
- This build gives agents two tools, `create_assistant` and `update_assistant`. Tell the agent what assistant you want (say, “add a reviewer on Codex, GPT-5.5, high effort, read-only, for reviewing diffs”) and it creates it; say “switch the reviewer to GPT-5.4” or “add a rule to the reviewer's instructions” and it changes it.
- When creating one, Codeg starts that agent briefly to read its real options (a few seconds). Options you name are set as you said, the rest take the agent's own defaults (the ones the editor marks Recommended); when changing one, options you don't name stay as they are. If a model or option doesn't match, nothing is saved and the agent is told what is available.
- The conversation shows a “Creating assistant …” row; expand it to see the assistant's agent, options and instructions, and click Edit to open the same editor as in Settings. The new assistant is in the @ menu right away and can be delegated to at once.
- The switch is “Create assistants” under Settings → Collaboration → In-conversation tools, on by default; turned off, agents don't see the two tools. An agent switched to “handles files and commands itself” doesn't get them, just as it doesn't get the delegation tools.

</details>

<details>
<summary><strong>Grouped Settings</strong>: details</summary>
<br/>

- The nav is grouped under five headings (Basics, Agents, Content, Control, Connections & upkeep); the pages and their order are the same as in the official build.
- Appearance, General, System, Version Control and Translation put related settings on one card under a group name, and a setting with a single switch or dropdown is one row: name and description on the left, control on the right. Appearance goes from twelve cards to three groups; on Version Control, “Add account” moves to each section's heading.
- Every page opens with a title and a one-line description; the proxy switch is a toggle like everywhere else; on a phone, a dropdown or button that doesn't fit moves below its description; in a wide browser window, form pages are capped in width and centered.

</details>

<details>
<summary><strong>Sub-agents wake the main agent when done</strong>: details</summary>
<br/>

- In the official build, once the main agent has sent a sub-agent off, the only way it learns the result is to check with `get_delegation_status` itself: either blocking until it arrives or checking every so often. Once it ends its turn, nobody tells it when the sub-agent finishes; it waits until you send another message reminding it to check.
- This build hands the result back to the main agent when a sub-agent finishes (or stops on an error partway):
  - Main agent idle: after 2 seconds (results that arrive together are combined into one), a new turn starts by itself and the main agent carries on from the results;
  - Main agent in the middle of a turn: Claude Code, Codex, Grok, Kiro and Antigravity get the results within that turn; other agents get them in a new turn that starts by itself once that one ends;
  - You are just sending a message: the results go along with it.
- The conversation shows a “Subtask results handed back” row naming each sub-agent, whether it finished or failed, and how long it took; expand it for a summary of each result and “Open session”. Results that went with your message show under it as “N subtask results attached”. This row is codeg writing to the main agent: it isn't passed on to chat channels as if you had said it, and it isn't used to name the session.
- Results the main agent already got itself with `get_delegation_status` or `cancel_delegation` aren't sent again; sub-tasks canceled by the main agent or by you aren't sent.
- Clicking Stop stops the main agent and the sub-agents it has running, as in the official build; results that finished earlier but hadn't been delivered yet go with your next message. When the main agent's turn ends in an error (rate limit, network drop and so on), the official build cancels its sub-agents along with it; this build lets them finish. In that case, and after 20 automatic continuations in a row, no new turn starts by itself: the results wait for your next message, and a note beside “N running” says so.
- The switch is “Wake the main agent when a subagent finishes” under Settings → Collaboration → Multi-Agent Collaboration → General, on by default; it applies to sessions started after you change it. Turned off, it works as in the official build: the main agent has to check for itself.

</details>

<details>
<summary><strong>Sub-agents work in their own worktree</strong>: details</summary>
<br/>

- In the official build every sub-agent works in the main agent's working folder, so two sub-agents sent to change code at the same time edit the same files; the model has to be set beforehand in the @ assistant or in Settings, and the main agent can't pick one for the task; and once a sub-agent has finished, changing anything more means opening a new session and explaining it all again.
- This build gives `delegate_to_agent` three new parameters:
  - `isolation: "worktree"`: the sub-agent works in a new git worktree on branch `delegate/<id>`, created from the commit the main agent is on; the main agent's uncommitted changes aren't in it, which the reply to the delegation points out. The worktree goes in the “Worktree location” set for “To-dos” (next to the repository if that isn't set), in a folder named `<repo>-delegate-<id>`. When the sub-agent finishes, its result gives the path, the branch and what changed; the main agent reviews it and merges it with git, or leaves it to you. Works only in a git repository with at least one commit.
  - `model` and `config`: a model and options for this delegation only (such as `{"reasoning_effort": "high"}`), on top of the defaults from the @ assistant or Settings; options not given stay as they are. Once the sub-agent starts they are checked against the options it actually offers: if one doesn't match, it isn't allowed to start and the main agent is told what is available; options it doesn't have at all are ignored, and the reply says so.
- A new tool, `continue_delegation`, gives a sub-task that has ended (finished, failed or canceled) more work in its original sub-session, keeping its context, working folder, model and options; the result comes back to the main agent the same way. Each follow-up is a new round with a new task_id. How it differs from `resume_delegation`: resume picks up work that was cut off partway, continue asks for more once it's done.
- The delegation row gets model, branch and “Round N” tags after its title; expand it to see the model, the options and the worktree's state (the commit it was created from, how many files changed). “Open” opens the worktree in the workspace, where you review the changes, commit and merge, and “Remove worktree” removes it, its branch too if you like.
- Worktrees aren't removed automatically. When you delete a sub-session that used one, the confirmation adds “Also remove its worktree”; if it has uncommitted changes, that box is unticked by default and says how many.

</details>

<details>
<summary><strong>Steer while the agent works</strong>: details</summary>
<br/>

- In the official build, Enter queues while the agent replies; steering hides behind the small arrow next to Send and goes straight into the turn only for Claude Code and Codex. Other agents need “Live Feedback” switched on in settings and only get a note they may read when they check. The queue lives in the current browser and is gone on reload, and after a stop the next queued message goes out at once.
- This build follows T3 Code:
  - The send button: Stop while the composer is empty; with something in it, the icon says what a click does — steer (↱) or queue (list +). Holding ⌘/Ctrl flips the icon, and a ⌘/Ctrl-click does the other one; on a phone, a long press on Send picks the other one for that message.
  - Steering is the default; “Sending while the agent replies” in Settings → General → Tabs & input switches it to queueing, on this device only.
  - Keys (changeable in Settings → Shortcuts): Enter sends the default way; ⌘/Ctrl+Enter the other way; ⌘/Ctrl+Shift+Enter steers the oldest queued message in; Alt+↑ with the caret at the start of the composer edits the latest queued one.
  - Slash commands always queue, and so does a steer while the agent is compacting its context.
- How a steer arrives: Claude Code, Codex, Grok, Kiro (text only) and Antigravity 1.5.0+ take it into the running turn and read it after the step at hand. Any other agent has its turn stopped and started again in the same session with your message: the reply that was cut off folds into “Attempt cut off by a steer”, the step in progress is lost, and the sub-agents it delegated keep running. Grok without native steering only queues (its cancel takes the running tool down too).
- A steered message is marked “Steer”, and “Steer · waiting to be read” while it is on its way; the marks survive a reload.
- The queue lives on the server: every window and device sees the same one, and it survives reloads and restarts. On a computer it shows as dashed bubbles at the end of the conversation, on a phone above the composer; each message can be sent now (into the running turn, or as a new turn when idle), edited, removed and dragged into order. The server sends the next one when a turn ends normally, even with every browser closed, and it carries any sub-task results not yet delivered.
- A stop, a turn that ends in an error (rate limit, network…) or a server restart pauses the queue: “Queue paused” with “Continue” shows above the composer; Continue, Enter in an empty composer or a new message lets it go. A steer still on its way when you stop is reported as not delivered, with a button to put it back in the composer.
- The official build's “Live Feedback” notes are gone: no switch in settings, and agents no longer get the `check_user_feedback` tool.

</details>

<details>
<summary>Details on <strong>T3-style compact conversation view</strong></summary>
<br/>

- <strong>On by default, reversible anytime</strong>: switch between “Compact (T3 style)” and “Timeline (classic)” under Settings → Appearance → Conversation style (saved per device, takes effect immediately).
- <strong>Live line &amp; auto-fold</strong>: while the agent works, “Working for Xs” is a timer line with a light running across it; each finished group of tool calls is one summary line (“Read 2 files, searched once”), prose in between stays in place, and the step under way gets a shining line of its own — click it to open that group. When the reply ends, the same line turns into “Worked for Xs ›” and everything above the answer folds under it; opening it shows those summary lines again, and each group opens its steps in a short self-scrolling box that fades at its edges. Opening or closing anything keeps the clicked line where it is. Unrecovered failures, pending approvals, questions, plans, running sub-agents and generated images always stay outside the fold; a round you opened while it was running stays open.
- <strong>Four tool-call visibility levels</strong>: switch between Show all, Hide successful, Hide all, and Zen mode in Settings or the conversation header “…” menu.
- <strong>Changed-files tree &amp; diff panel</strong>: replaces reply file cards with a sticky-header directory tree (single-child directory chains merged, auto-expanded up to 8 files, virtualized past 250 rows). Clicking any file opens its diff panel, previewable new files (HTML/Markdown/images) preview inline, and edit rows also offer a hover button to open the diff panel.
- <strong>Quieter bubbles &amp; hover footer</strong>: consecutive user messages group tightly, images render as an in-bubble collage, long prompts fold only past 22rem, and hover reveals timestamp, copy, and Edit in composer (no file revert). Reply actions (copy, translate, fork, create task, model, tokens, time) appear on hover (always shown on the last reply); live tok/s speed is off by default. Sending pins your message 24px from the top so the reply grows downward.
- <strong>Minimap, whole-thread find, citations &amp; Carbon theme</strong>: desktop shows a left-edge timeline minimap with hover preview and click-to-jump; ⌘/Ctrl+F (or header “…” menu) searches the entire conversation including unloaded history and auto-expands folded hits; quoting creates composer citation chips whose sent cards jump back and highlight for 2s; code blocks gain a line-wrap toggle and shell blocks add “Run in terminal” (pastes without executing); Appearance adds the pure-black “Carbon” theme preset.

</details>

<details>
<summary><strong>Snappy over a remote link</strong>: details</summary>
<br/>

- On a high-latency, lossy public link the official build feels sluggish: streamed text goes out as one WebSocket frame per small chunk, and each frame waits for the previous one to be acknowledged (Nagle), so text arrives in clumps half a second apart. One lost packet makes the default congestion control halve the sending rate, so the 1.9 MB of scripts on first load takes over twenty seconds. A reconnect fetches the whole conversation snapshot again. Screenshots are embedded in the conversation as base64 and sent in full on every open. Opening a conversation parses the same transcript three times on the server. Leaving a conversation disconnects its agent, so switching back reconnects and reloads everything.
- What this build gets (simulated link: 368 ms round trip, 7% packet loss, scripted agent; a conversation of 150 rounds with 10 screenshots):

  |  | Official build | This build |
  | --- | --- | --- |
  | First open to typing | 24.8 s | 8–14 s |
  | Reload to typing | 2.7 s | 1.1–1.2 s |
  | Open a long conversation to its last round | 12.3 s | 0.8 s |
  | Switch back to a conversation you just saw | 6.3 s (reloads everything) | 0.2 s |
  | Gap between text updates while replying (median / 95th percentile) | 366 / 460–731 ms | 34–38 / 66–100 ms |

- Connection: the server turns Nagle off and uses BBR congestion control (packet loss is no longer taken for congestion), and keeps the kernel's queue of unsent data small so a heartbeat never waits behind a large payload. The WebSocket gains a `codeg-events.v2` subprotocol: streamed text is merged into one frame every 100 ms, and large frames are compressed and split. The page checks every 5 seconds and only treats 15 seconds of silence as a lost connection; it then reconnects right away and receives only the events it missed. Recovering within 8 seconds shows no notice, and an outage of 3 or 8 seconds needs no reconnect at all. The desktop app connected to a remote server uses v2 too.
- Opening a conversation: screenshots load separately, on demand, as a thumbnail first, and are not downloaded again once seen. Tool output over 24 KB is sent as its beginning and end only, with the full text fetched when you expand it. The first screen fetches only the latest rounds, by size. The server caches parsed Claude Code conversations and parses again only when the transcript changes.
- Switching conversations: leaving a conversation parks its agent instead of disconnecting it, and switching back picks it up directly. Pressing or hovering a conversation in the sidebar starts fetching it. Parked agents take memory, so the server keeps at most 6 idle ones and disconnects the longest unused beyond that.
- Startup: hashed static files are cached for good; reloading goes straight to the workspace; the 20 requests startup needs are combined into one and sent before the page scripts have finished downloading.
- Server environment variables (rarely needed):

  | Variable | Default | What it does |
  | --- | --- | --- |
  | `CODEG_WS_COALESCE_MS` | `100` | Window for merging streamed text into one frame (ms, at most 1000; `0` disables merging) |
  | `CODEG_TCP_CONGESTION` | `bbr` | Congestion control for web connections; the system default if the kernel lacks it; empty or `off` leaves it unchanged |
  | `CODEG_TCP_NOTSENT_LOWAT` | `65536` | Most unsent bytes the kernel holds per connection; `0` for no limit |
  | `CODEG_ACP_MAX_IDLE_CONNECTIONS` | `6` | Idle parked agents to keep; `0` for no limit (idle agents are still reclaimed by time) |
  | `CODEG_ACP_IDLE_HOLD_GRACE_SECS` | `90` | Seconds untouched before a parked agent counts as idle |
  | `CODEG_DETAIL_CACHE_ENTRIES` | `6` | Parsed Claude Code conversations to cache; `0` disables the cache |

</details>

<details>
<summary><strong>Buttons react at once, replies flow evenly</strong>: details</summary>
<br/>

- In the official build every button waits for the server's answer: on a 368 ms round trip, an approved permission card takes 0.4 s to go away, rename and delete take half a second, and Stop gives no sign it was pressed. A request lost on the way simply fails. When the network stutters, replies jump in bursts.
- This build:
  - Rename, delete, pin, status, a folder's color, alias and default agent, removing a folder from the workspace, approving permissions, answering questions and approving plans: the change is made locally and shows the moment you press. If the server refuses and the screen still shows your change, it is undone with a notice; a model or option that didn't take is also set back to its previous value.
  - Their requests are retried up to twice on a network error. Requests that create something — sending a message, a new conversation, steering, queueing — carry an idempotency key: the server runs a repeat only once and answers with the first result, so no message or conversation is doubled.
  - Stop spins the moment you press it. It stops only the round you pressed it for: if that round already ended and the next queued message started, that one keeps running.
  - A mode you switch to is sent with the message, saving a round trip.
  - Steering and queueing clear the composer at once; a message that didn't get through goes back into the composer, images and quotes included.
  - Creating or forking a conversation no longer reloads the whole conversation list.
- Measured (same link): permission approved to card gone 0.42 s → 5 ms; rename 0.49 s → 0.06–0.09 s; delete 0.45 s → 0.07–0.2 s; Stop reacting 0.46 s → 0.03–0.07 s.
- Steady text: on a slow link a reply is shown at the rate it has recently been arriving, a little behind it. How far behind is set from the link's longest recent stall (at most 1.5 s). On a smooth link nothing is held, as before. Before a tool card, a permission request or the end of the round appears, everything held is shown first, so the order never changes. Measured on the same link: median gap between text updates 100 → 34–38 ms, 95th percentile 190–214 → 66–100 ms. Turn it off in Settings → Appearance → Smooth streaming text; it applies to this device only.

</details>

### Releases

|  | This build | Official build |
| --- | --- | --- |
| Downloads and updates | This repository's [Releases](https://github.com/keh4l/codeg/releases), signed with this fork's own key | [spacering-net/codeg](https://github.com/spacering-net/codeg/releases) Releases |
| Version | `<upstream version>-<n>`: `0.33.0-2` is the 2nd build on upstream 0.33.0 | e.g. `0.33.0` |
| macOS notarization | None; allow it once on first launch (see [Install](#install)) | Yes |
| Docker image | None | Yes |

Updates never cross over: this build never updates to an official release, and an official build never updates to this one. The `keh4l` branch is upstream's `main` plus the changes above.

## Install

### Desktop

Download the latest installer from [Releases](https://github.com/keh4l/codeg/releases/latest):

| System | Installer |
| --- | --- |
| macOS (Apple Silicon or Intel) | `.dmg` |
| Windows (x64 or ARM64) | `-setup.exe` |
| Linux | `.deb`, `.rpm` or `.AppImage` |

It installs as the same app as the official Codeg: it replaces it and keeps your conversations and settings.

> [!NOTE]
> On macOS, if the first launch says the app is damaged or can't be opened, run this once, or allow it under System Settings → Privacy & Security:
>
> ```bash
> xattr -cr /Applications/codeg.app
> ```

### Server

Linux or macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Both install from this repository's releases, and the server's built-in updater uses them too.

### Going back to the official build

> [!WARNING]
> Back up your Codeg data first. This build adds database migrations the official build doesn't have (the translation tables, for one), and an official build may refuse to start on the same data.

## Documentation

For features, configuration and usage, see the official [README](https://github.com/spacering-net/codeg#readme) and [docs.codeg.app](https://docs.codeg.app). They describe the official build; the differences are listed above.

## License and acknowledgments

Apache-2.0, see [LICENSE](../../LICENSE). Codeg is created by [xintaofei](https://github.com/xintaofei) and its contributors; this build only adds to it. Codeg builds on [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) and [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
