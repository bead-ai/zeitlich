# Changelog

All notable changes to this project will be documented in this file.

## [0.2.22](https://github.com/bead-ai/zeitlich/compare/v0.2.21...v0.2.22) (2026-03-17)


### Features

* add `fork` method into Sandbox interface ([#42](https://github.com/bead-ai/zeitlich/issues/42)) ([0713daa](https://github.com/bead-ai/zeitlich/commit/0713daafaa1b14c01d2b2d4c24bf317fa4a1693e))
* add adapter-prefixed thread and sandbox operations for Google GenAI and LangChain ([423862e](https://github.com/bead-ai/zeitlich/commit/423862eab734e002b5c97f883c177b9e1c888d89))
* **sandbox:** update createActivities to support prefixed names for activity functions ([b08acf2](https://github.com/bead-ai/zeitlich/commit/b08acf2f4ae433f523c91c181c10e60141a5d82a))
* **session:** introduce ScopedPrefix type and enhance thread operations for Google GenAI and LangChain adapters ([98c3f12](https://github.com/bead-ai/zeitlich/commit/98c3f12cf937796d7dcbe8cd262a053da62d25a6))
* **subagent:** support function context in SubagentConfig ([#46](https://github.com/bead-ai/zeitlich/issues/46)) ([238826c](https://github.com/bead-ai/zeitlich/commit/238826c3db92deb02b479c4933c6b402b475d0d0))
* update sandbox and thread proxy operations to derive scope from workflow context ([28bc655](https://github.com/bead-ai/zeitlich/commit/28bc655f9bc4a8ac01429dd45224eed58af1b0f3))


### Bug Fixes

* add acts for fork sandboxes ([6c1a606](https://github.com/bead-ai/zeitlich/commit/6c1a6068b4602c14c30b8ac9ceef4aff68544c90))
* tests ([1c86976](https://github.com/bead-ai/zeitlich/commit/1c869767eaa9caab8aef7015ee1dcb75cd2a624f))


### Code Refactoring

* update activity naming convention to prepend adapter prefix and append workflow scope ([1297a8f](https://github.com/bead-ai/zeitlich/commit/1297a8f91f584272e8929072090dfdf8331cd7aa))


### Miscellaneous Chores

* release 0.2.22 ([0dde565](https://github.com/bead-ai/zeitlich/commit/0dde565c9cd3acb8173484313b7a07cc54554607))

## [0.2.21](https://github.com/bead-ai/zeitlich/compare/v0.2.20...v0.2.21) (2026-03-16)


### Features

* use stable workflow ids as message keys ([a5f3c6e](https://github.com/bead-ai/zeitlich/commit/a5f3c6eeb671d8908f42288f6a196eefaabf053c))


### Miscellaneous Chores

* release 0.2.21 ([dba1108](https://github.com/bead-ai/zeitlich/commit/dba11082f641e73e781e3aae59f8b034b19abce9))

## [0.2.20](https://github.com/bead-ai/zeitlich/compare/v0.2.19...v0.2.20) (2026-03-16)


### Features

* **session:** add activity proxy function for tool result handling ([eb66473](https://github.com/bead-ai/zeitlich/commit/eb664739fb753a7ec15ba4656846b3d420d8e8fa))
* **workflow:** introduce configuration for workflow definition ([787d75a](https://github.com/bead-ai/zeitlich/commit/787d75a31ca6d423cef183d23936b1868ea66940))


### Bug Fixes

* minor subagent adjustments ([7947813](https://github.com/bead-ai/zeitlich/commit/79478131dabaece3fbda54a9846a5d18e0c97171))
* remove stateful workDir implementation for daytona ([b2d4404](https://github.com/bead-ai/zeitlich/commit/b2d44046f3ab253cf9c01a136d8c298c2230a005))
* wrong test ([26bc842](https://github.com/bead-ai/zeitlich/commit/26bc8420cbfc0d7dcc55d25018bf049043f54d09))


### Miscellaneous Chores

* release 0.2.20 ([366d695](https://github.com/bead-ai/zeitlich/commit/366d69577ea104de05cc655fb420d6a2c8e993d8))

## [0.2.19](https://github.com/bead-ai/zeitlich/compare/v0.2.18...v0.2.19) (2026-03-13)


### Code Refactoring

* **subagent, tool-router:** enhance dynamic evaluation for properties ([0ef7b8f](https://github.com/bead-ai/zeitlich/commit/0ef7b8f75e8b5913c08b053ef363247e07456492))


### Miscellaneous Chores

* release 0.2.19 ([84479ea](https://github.com/bead-ai/zeitlich/commit/84479eabafdffab3397a352e02754d2958fccb59))

## [0.2.18](https://github.com/bead-ai/zeitlich/compare/v0.2.17...v0.2.18) (2026-03-13)


### Features

* **subagent:** support dynamic evaluation for enabled state ([2b5d0fa](https://github.com/bead-ai/zeitlich/commit/2b5d0faa71334fddb263d09e58d4ca6de0a3b21f))


### Bug Fixes

* getter support for enabled ([be177c2](https://github.com/bead-ai/zeitlich/commit/be177c261d87f0d05cb966140b545a6066c94bbc))


### Miscellaneous Chores

* release 0.2.18 ([c838d34](https://github.com/bead-ai/zeitlich/commit/c838d348a2c4b257be5e9dc403bc0c735fc522d8))

## [0.2.17](https://github.com/bead-ai/zeitlich/compare/v0.2.16...v0.2.17) (2026-03-13)


### Features

* add hasDirectory util for virtual fs ([42bf635](https://github.com/bead-ai/zeitlich/commit/42bf63507a6816f7194d86f3f46f36d0e0c8c5a0))
* add mime type util for virtual fs ([31a88a9](https://github.com/bead-ai/zeitlich/commit/31a88a91a19a9484b25bf15c644d8123d7a7c5d6))
* **subagent:** enhance defineSubagentWorkflow with metadata support ([d207ddd](https://github.com/bead-ai/zeitlich/commit/d207ddd6e0b00b993e2ceb75ce0152e1544986de))
* **subagent:** enhance subagent workflow definition and registration ([b32c626](https://github.com/bead-ai/zeitlich/commit/b32c626ca8e47cea1af8a96c5aeb050030bc6f90))


### Bug Fixes

* add temporal workflwo name ([3e48964](https://github.com/bead-ai/zeitlich/commit/3e48964f836a42ae63c2c38d1520a4dd897e088a))


### Code Refactoring

* **subagent:** update workflow function signature and input handling ([8a04a3f](https://github.com/bead-ai/zeitlich/commit/8a04a3f7319645b005cfcc2e908fa84745cc7725))
* **workflow:** update input handling in defineWorkflow function ([4df94ac](https://github.com/bead-ai/zeitlich/commit/4df94accddbcfd34fbf5b4081d577557d9557874))


### Miscellaneous Chores

* release 0.2.17 ([e2f319b](https://github.com/bead-ai/zeitlich/commit/e2f319b78a7f5931b57119dd12d511c58b9f1f14))

## [0.2.16](https://github.com/bead-ai/zeitlich/compare/v0.2.15...v0.2.16) (2026-03-12)


### Features

* introduce workspaceBase for consistent path resolution in sandboxes ([5066050](https://github.com/bead-ai/zeitlich/commit/5066050b5da27b95cb066e1ff661d736f7ff510a))


### Code Refactoring

* normalize file paths in sandbox file systems ([b61921b](https://github.com/bead-ai/zeitlich/commit/b61921bb0ea1dd125cf3b865883701eefaffb1c8))


### Miscellaneous Chores

* release 0.2.16 ([f39ce8f](https://github.com/bead-ai/zeitlich/commit/f39ce8f94f8c2d07309c6429a7aeeb70c227e755))

## [0.2.15](https://github.com/bead-ai/zeitlich/compare/v0.2.14...v0.2.15) (2026-03-10)


### Code Refactoring

* implement thread forking functionality ([40de4b7](https://github.com/bead-ai/zeitlich/commit/40de4b799f2e983d53fef8c2d9e3766160c38cbd))
* improve subagent registration logic and dynamic configuration ([0213855](https://github.com/bead-ai/zeitlich/commit/0213855086f8dd0d8d36a9fcf1115e32f2080470))


### Miscellaneous Chores

* release 0.2.15 ([2fe046a](https://github.com/bead-ai/zeitlich/commit/2fe046ace301a92873f9c1a3a799c17bc2224e73))

## [0.2.14](https://github.com/bead-ai/zeitlich/compare/v0.2.13...v0.2.14) (2026-03-10)


### Features

* add Daytona adapter support and update dependencies ([42cea4b](https://github.com/bead-ai/zeitlich/commit/42cea4bf2595effa5bc1c91dbd170774f2a230ef))
* add Daytona adapter support and update dependencies ([bebb2c8](https://github.com/bead-ai/zeitlich/commit/bebb2c8c598dd0f4b23e3960f414cb68cc9a6210))
* add Google GenAI adapter for enhanced model invocation and thread management ([d96e15c](https://github.com/bead-ai/zeitlich/commit/d96e15cc633c72d275d85aea3c2184667e3d3af1))
* add sandbox layer ([7f48985](https://github.com/bead-ai/zeitlich/commit/7f489853fce569807f02a763b73adf047b3a7afa))
* cleaner langchain thread id ([fa255e7](https://github.com/bead-ai/zeitlich/commit/fa255e7f24f5ea8fa7d3ce59040c4596d8d60865))
* export fileEntriesToTree function from virtual sandbox module ([96b72d2](https://github.com/bead-ai/zeitlich/commit/96b72d2bc306615aed8767bcdf18511197370a32))
* introduce new type definitions for tool router, subagent, model, session, and state management ([0d70680](https://github.com/bead-ai/zeitlich/commit/0d70680450c90a08cabc7b88430e4637db0f0f1f))
* introduce thread management adapters for Google GenAI and LangChain ([9b15d3a](https://github.com/bead-ai/zeitlich/commit/9b15d3a0e96c5d1879825fb174bf8625707a8cc6))
* refactor FileSystemSkillProvider to use sandbox filesystem abstraction ([d3a5f81](https://github.com/bead-ai/zeitlich/commit/d3a5f81dd86bfdaeded8a81937948fbc2adc72fc))
* remove agent name requirement for queries ([1d01342](https://github.com/bead-ai/zeitlich/commit/1d0134227b0b2a903120e3bae9429544e28cc3fc))


### Bug Fixes

* generic file entry ([e462e13](https://github.com/bead-ai/zeitlich/commit/e462e1384a6585a8d8e42ad141d01cbb1028df07))
* thread ids ([f908b1d](https://github.com/bead-ai/zeitlich/commit/f908b1df0bf4c256f6725d30ac984eb87ff192d8))


### Code Refactoring

* add virtual sandbox adapter exports ([e0f3f82](https://github.com/bead-ai/zeitlich/commit/e0f3f820c7cead4e35ddbcf6d5d8c1d1c00e25eb))
* add withSandbox wrapper ([2b70f86](https://github.com/bead-ai/zeitlich/commit/2b70f865191096458c4a303a94cf92a139b6ecab))
* cleanup types ([554e132](https://github.com/bead-ai/zeitlich/commit/554e13274996caededa8b26f8e150427a14c13a3))
* consolidate tool execution hooks and update type definitions ([88ba405](https://github.com/bead-ai/zeitlich/commit/88ba4051677d9988f4e918b4bd0c8eae3073b255))
* enhance return type structure in withVirtualSandbox function ([6e82e8f](https://github.com/bead-ai/zeitlich/commit/6e82e8fbfdfc8b5575f99a7d7e72cf75779a518a))
* enhance sandbox provider and manager type definitions ([e5bcd20](https://github.com/bead-ai/zeitlich/commit/e5bcd203bb8a44951b10c4301414b4d76fc810a3))
* enhance subagent type definitions for improved response handling ([4b5cbc7](https://github.com/bead-ai/zeitlich/commit/4b5cbc7e33bb85ed76864446c776d6ed6bd1e5bf))
* enhance tool call processing with pre and post hooks ([4d62bff](https://github.com/bead-ai/zeitlich/commit/4d62bffadb27f40573bedea2d8626902853bb403))
* enhance type safety in createRunAgentActivity and withParentWorkflowState ([31cc08c](https://github.com/bead-ai/zeitlich/commit/31cc08c783310146eb03840b1732785e8d98bd38))
* enhance virtual sandbox functionality ([093e0d2](https://github.com/bead-ai/zeitlich/commit/093e0d22563cac47d12e847022fe356c765fc5b0))
* enhance virtual sandbox type definitions ([75d4322](https://github.com/bead-ai/zeitlich/commit/75d43225f1e2759190dde022ab51edb32426728e))
* extend error handling by inheriting from ApplicationFailure ([6cce6d7](https://github.com/bead-ai/zeitlich/commit/6cce6d7a93a9f86df7b28406da9be9245641bc23))
* generalize fileEntriesToTree function to accept any FileEntry type ([9d4ca8f](https://github.com/bead-ai/zeitlich/commit/9d4ca8f235e6f4df77c8ebfe41c75af646dd2f3d))
* improve type definitions in Daytona sandbox provider and manager ([e4a443b](https://github.com/bead-ai/zeitlich/commit/e4a443b698be6af7f411bf81476536cc63377f4b))
* improve type definitions in withVirtualSandbox function ([6ab6b1c](https://github.com/bead-ai/zeitlich/commit/6ab6b1cbf33cebc3c1c9d2323622a418c0c785d9))
* move fs ([f1d5121](https://github.com/bead-ai/zeitlich/commit/f1d512145968191995a096783a16b09cb7b0dd73))
* move to router ([b32997d](https://github.com/bead-ai/zeitlich/commit/b32997d9e91a6df6c89247d34197df23c77f982f))
* remove FileSystemSkillProvider export from index.ts ([c306a93](https://github.com/bead-ai/zeitlich/commit/c306a93f121461d11fc25bc32f4e3a18c568d901))
* rename and update applyTreeMutations to applyVirtualTreeMutations ([f4c9e12](https://github.com/bead-ai/zeitlich/commit/f4c9e1259d3145826ce78bcf708a593dc9ce0301))
* rename sandbox implementations and enhance type definitions ([0c36722](https://github.com/bead-ai/zeitlich/commit/0c367226ebd6a65bbab8be4bc4176f3b4f38ce7a))
* rename VirtualSandbox and update type definitions ([2db7517](https://github.com/bead-ai/zeitlich/commit/2db751723d668d116bd2849e5c361d78ca7877de))
* reorganize FileSystemSkillProvider export ([ccaa7fe](https://github.com/bead-ai/zeitlich/commit/ccaa7fe7f205bf868ea39a2de6470e645e05bb89))
* replace createRunAgentActivity with withParentWorkflowState ([5e14c18](https://github.com/bead-ai/zeitlich/commit/5e14c18be1c16843275232710a9f31a409e47fea))
* replace withParentWorkflowState with createRunAgentActivity ([00e2f0c](https://github.com/bead-ai/zeitlich/commit/00e2f0c480d5cc793d6441ab03b60d59d4af3843))
* sandbox more generic ([6c72fdf](https://github.com/bead-ai/zeitlich/commit/6c72fdf830c3efe08adb7c3f92997e602d51bc80))
* simplify DaytonaSandboxProvider by removing sandbox caching ([310beca](https://github.com/bead-ai/zeitlich/commit/310beca76ee9d26934c7cc0f7214c4c7d30d147e))
* simplify model type definitions in LangChain adapter ([3cfcc1e](https://github.com/bead-ai/zeitlich/commit/3cfcc1e4981d6d2aa699d4be3048ebe27d184502))
* structure ([6d9e0cd](https://github.com/bead-ai/zeitlich/commit/6d9e0cdcaba8b2a5cc8fd5e1044b415e141705d8))
* update Bash handler to use SandboxManager directly ([3f854f0](https://github.com/bead-ai/zeitlich/commit/3f854f0569f10e4614886bbc5aed8150b3c02635))
* update fileEntriesToTree function to use more specific type for entries ([c84be09](https://github.com/bead-ai/zeitlich/commit/c84be09569b8186ce2de799a07a35eef54ebfbca))
* update README and CONTRIBUTING files for improved clarity and structure ([06a7cf2](https://github.com/bead-ai/zeitlich/commit/06a7cf2d190a3be8383adfc6d91cf1e2f7e14fce))
* update session type definitions and improve return types ([d94c6dc](https://github.com/bead-ai/zeitlich/commit/d94c6dc559bdad9a8737a477f56e647100d0b402))


### Documentation

* add AGENTS.md with Cursor Cloud setup instructions ([#25](https://github.com/bead-ai/zeitlich/issues/25)) ([ad50f4c](https://github.com/bead-ai/zeitlich/commit/ad50f4c348fae1588e9ab501ccc69927cfef29f1))


### Miscellaneous Chores

* release 0.2.14 ([1fc218b](https://github.com/bead-ai/zeitlich/commit/1fc218bb83183538fb06918ecceef873abae4680))

## [0.2.13](https://github.com/bead-ai/zeitlich/compare/v0.2.12...v0.2.13) (2026-03-04)


### Code Refactoring

* update ToolMessageContent type to use MessageContent for improved flexibility ([3dd7af6](https://github.com/bead-ai/zeitlich/commit/3dd7af64a7ee7ad8e4ab6f682155a61413fa9fca))


### Miscellaneous Chores

* release 0.2.13 ([b415fe1](https://github.com/bead-ai/zeitlich/commit/b415fe1657b6e7fc7407a95a67d52e9c39a7e388))

## [0.2.12](https://github.com/bead-ai/zeitlich/compare/v0.2.11...v0.2.12) (2026-03-04)


### Features

* add provider specific adapters ([2c2ca6d](https://github.com/bead-ai/zeitlich/commit/2c2ca6dbdd0e798b3b61aad43252c833cb11dbcb))
* add workflow state query helper and update invokeModel parameters ([5ea8275](https://github.com/bead-ai/zeitlich/commit/5ea8275a8626d6336f225e8eaf528aa2b1003209))
* enhance thread management with existence checks ([5047721](https://github.com/bead-ai/zeitlich/commit/50477219eff028a52379e9f0c700149aa27f398b))
* implement thread continuation support in subagent workflows ([0dbef0b](https://github.com/bead-ai/zeitlich/commit/0dbef0bb6b59b45d0cf2600ed3be79079e49c64c))
* make threadId optional in session configuration ([048f545](https://github.com/bead-ai/zeitlich/commit/048f5454776215cbe40dfb068af6094ff8946c85))


### Bug Fixes

* improve type safety in workflow function ([d3656f0](https://github.com/bead-ai/zeitlich/commit/d3656f017079290430e2e01e9e267335b1081493))
* only one activity call needed to start a thread ([6fa83de](https://github.com/bead-ai/zeitlich/commit/6fa83dea31223720644e037ba4df83177479095d))
* update workflow type to return specific ToolHandlerResponse ([4295fd3](https://github.com/bead-ai/zeitlich/commit/4295fd3b2e3c49a7815c03346dbcf98866e2394f))


### Code Refactoring

* destructure LangChain adapter for improved readability and maintainability ([3bd32e9](https://github.com/bead-ai/zeitlich/commit/3bd32e92ef3478e4c73c2a4f019f83a6aabe0590))
* enhance createSubagentTool return type for clarity ([1f59dbf](https://github.com/bead-ai/zeitlich/commit/1f59dbfbe7ad8d914dc1eead612b6faab6d746d7))
* integrate createRunAgentActivity for improved tool management ([9ae6ed0](https://github.com/bead-ai/zeitlich/commit/9ae6ed0d21f1a0f4e73c248b807a325957ca57cb))
* rename langchain paths to adapters for consistency ([0301fea](https://github.com/bead-ai/zeitlich/commit/0301fea986cc8766e91652006cbb233f6b35f53e))
* streamline model invocation and enhance framework-agnostic interfaces ([10d750a](https://github.com/bead-ai/zeitlich/commit/10d750a6eb6cbb9565c350701ba4eaabc5c09b42))
* unify LangChain adapter for streamlined model invocation and thread management ([dcebbc6](https://github.com/bead-ai/zeitlich/commit/dcebbc650f81a3b2a75c9e51436ab9205d179b55))
* update ModelInvoker to utilize full agent state for improved tool management ([357bb79](https://github.com/bead-ai/zeitlich/commit/357bb795bc5c16260b625ee19eb5f535e7ed81af))


### Documentation

* align docs with latest changes ([e1efe2b](https://github.com/bead-ai/zeitlich/commit/e1efe2b3ffce2802936c3f08aba758464ea81303))
* update import paths for LangChain model invoker ([be5c6b0](https://github.com/bead-ai/zeitlich/commit/be5c6b0a3dde3fda79f38bdbe0cac2cb920ad154))
* update reaqdme order ([655fbaa](https://github.com/bead-ai/zeitlich/commit/655fbaaeb7a671abd5d30d340673ea05345b2493))


### Miscellaneous Chores

* release 0.2.12 ([a5c5c0a](https://github.com/bead-ai/zeitlich/commit/a5c5c0add81daaddd3e1412ff1fbec17836152ab))

## [0.2.11](https://github.com/bead-ai/zeitlich/compare/v0.2.9...v0.2.11) (2026-03-03)


### Features

* add agent query and update name helpers ([9fde6aa](https://github.com/bead-ai/zeitlich/commit/9fde6aa2e94a92b4a78a6df357b15206ca23953a))
* add idempotent message appending with Redis Lua script ([fbdbff5](https://github.com/bead-ai/zeitlich/commit/fbdbff5dfcd83dd6c3208129a01741052041a4ef))
* implement SKILL.md file parser ([db6067a](https://github.com/bead-ai/zeitlich/commit/db6067a8021d8f2dc6d9b7615e390d0404ac0b3d))


### Bug Fixes

* cleanup build in tool prompts ([134ed46](https://github.com/bead-ai/zeitlich/commit/134ed463aebf5acca780a0f4e18aad17484f3019))
* return ActivityToolHandler from createAskUserQuestionHandler ([#20](https://github.com/bead-ai/zeitlich/issues/20)) ([a86732b](https://github.com/bead-ai/zeitlich/commit/a86732b8aa173cd29da3e7e92d3885d5723684e1))


### Miscellaneous Chores

* release 0.2.10 ([6923bd2](https://github.com/bead-ai/zeitlich/commit/6923bd29f37ccbb2080f1ea04110600d8dd853f3))
* release 0.2.11 ([20acc6b](https://github.com/bead-ai/zeitlich/commit/20acc6b40c7796fe05427b5db5402ebc8e3ef3cb))

## [0.2.9](https://github.com/bead-ai/zeitlich/compare/v0.2.8...v0.2.9) (2026-02-24)


### Bug Fixes

* fix dynamic subagent enabled flag ([a80458c](https://github.com/bead-ai/zeitlich/commit/a80458c57fd4a73401aa7274ac6804d68bb69946))


### Miscellaneous Chores

* release 0.2.9 ([a18fd51](https://github.com/bead-ai/zeitlich/commit/a18fd51b8d3d57ec2dd916b345f831b4c26ae529))

## [0.2.8](https://github.com/bead-ai/zeitlich/compare/v0.2.7...v0.2.8) (2026-02-23)


### Code Refactoring

* enable dynamic tool choice ([54706df](https://github.com/bead-ai/zeitlich/commit/54706df3b055ad6a91773c45f9ecc34acc1ec443))
* replace usage structure with TokenUsage interface for consistency ([ecced84](https://github.com/bead-ai/zeitlich/commit/ecced84c6c0125c8a77d1423c5a2327335a97ced))


### Miscellaneous Chores

* release 0.2.8 ([93d36a0](https://github.com/bead-ai/zeitlich/commit/93d36a02e5d0b22268862c77c12bed5a0bae2d16))

## [0.2.7](https://github.com/bead-ai/zeitlich/compare/v0.2.6...v0.2.7) (2026-02-19)


### Features

* add ability to request and add external input ([d00917e](https://github.com/bead-ai/zeitlich/commit/d00917ef70366385975e8efc3b31cbd5f6021522))


### Miscellaneous Chores

* release 0.2.7 ([576658b](https://github.com/bead-ai/zeitlich/commit/576658b1a204573edee08a20e9999b4fd784356d))

## [0.2.6](https://github.com/bead-ai/zeitlich/compare/v0.2.5...v0.2.6) (2026-02-17)


### Bug Fixes

* add missing appendSystemMessage method ([fc5bb99](https://github.com/bead-ai/zeitlich/commit/fc5bb998d071b81695eee06faf1cfc8f12801046))


### Miscellaneous Chores

* release 0.2.6 ([61bc60a](https://github.com/bead-ai/zeitlich/commit/61bc60a49b42609adc4f96c179531fe82e747f0f))

## [0.2.5](https://github.com/bead-ai/zeitlich/compare/v0.2.4...v0.2.5) (2026-02-17)


### Documentation

* Add DeepWiki badge to README ([b887efb](https://github.com/bead-ai/zeitlich/commit/b887efb1b48537c062434ca945b9943d0670b12e))
* update docs to align with recent changes ([#15](https://github.com/bead-ai/zeitlich/issues/15)) ([2bd1e37](https://github.com/bead-ai/zeitlich/commit/2bd1e3782958440a515af844f42af01d05a83cea))


### Miscellaneous Chores

* release 0.2.5 ([c7ab91d](https://github.com/bead-ai/zeitlich/commit/c7ab91d8f1ffb8bd5c37e89472a6b9a5dc17e03d))

## [0.2.4](https://github.com/bead-ai/zeitlich/compare/v0.2.3...v0.2.4) (2026-02-12)


### Code Refactoring

* enhance task handler type safety and structure ([a95cdce](https://github.com/bead-ai/zeitlich/commit/a95cdce52b0fc4d2757ff467d3ae9321ead1ee73))
* move parseToolCalls into model call to avoid additional activity turn ([afe7b28](https://github.com/bead-ai/zeitlich/commit/afe7b2837ac7c2cd34d684568299921b71d320de))
* rename task tool to subagent tool ([25a50a5](https://github.com/bead-ai/zeitlich/commit/25a50a548e550bd9ad6030b88c359ea308d60e48))


### Miscellaneous Chores

* release 0.2.4 ([f4369d8](https://github.com/bead-ai/zeitlich/commit/f4369d8a813d2b52bee1a753d5a1389c2f1fab2a))

## [0.2.3](https://github.com/bead-ai/zeitlich/compare/v0.2.2...v0.2.3) (2026-02-11)


### Miscellaneous Chores

* release 0.2.3 ([0b21d1e](https://github.com/bead-ai/zeitlich/commit/0b21d1eeb7bf13ee4ab8f2026d4e2a721de827f6))

## [0.2.2](https://github.com/bead-ai/zeitlich/compare/v0.2.1...v0.2.2) (2026-02-10)


### Miscellaneous Chores

* improved interfaces and types ([#10](https://github.com/bead-ai/zeitlich/issues/10)) ([58dcfff](https://github.com/bead-ai/zeitlich/commit/58dcfffc0acfa0ddb008c3c63c5355e9b5251607))

## [0.2.1](https://github.com/bead-ai/zeitlich/compare/v0.2.0...v0.2.1) (2026-02-06)


### Features

* extend bashTool options, make `fs` required at least ([673e69b](https://github.com/bead-ai/zeitlich/commit/673e69bf3215cde873bebc2881876da9f7079f16))
* increase max string length in BashTool 10-&gt;50mb ([87ceaf8](https://github.com/bead-ai/zeitlich/commit/87ceaf89800b163505f517a5ee7c62be4ed59037))


### Miscellaneous Chores

* release 0.2.1 ([f46b643](https://github.com/bead-ai/zeitlich/commit/f46b6434de92babb703640149915647484b40763))

## [0.2.0](https://github.com/bead-ai/zeitlich/compare/v0.1.1...v0.2.0) (2026-02-06)


### Features

* add support to pass `BashOptions` to Bash tool ([5e8e674](https://github.com/bead-ai/zeitlich/commit/5e8e6742244f61ea5b41e2049148868b716f1067))
* add task management tools ([03c1c5a](https://github.com/bead-ai/zeitlich/commit/03c1c5a7b8430c496d1a197044c877263256a660))
* mvp Bash tool ([697c20c](https://github.com/bead-ai/zeitlich/commit/697c20c8c47bea536f268a4eef788bc305b93996))


### Bug Fixes

* add empty schema for task list tool ([1dc0041](https://github.com/bead-ai/zeitlich/commit/1dc00411a92f8fe2b4d6e270e4807dc8dedfc795))


### Code Refactoring

* add tasks to state store ([82e3b19](https://github.com/bead-ai/zeitlich/commit/82e3b1985bf64b526f006d1073df1fa9dbf37a38))
* enforce context requirement in tool handlers ([428f84c](https://github.com/bead-ai/zeitlich/commit/428f84cd071b4197b9e53d3fd875eb98da2e1030))
* enhance file handling with database integration ([8190003](https://github.com/bead-ai/zeitlich/commit/81900033dfe41d7578252441c5ec2d56df0b1b65))
* enhance file node structure and tool handler type definitions ([3157bab](https://github.com/bead-ai/zeitlich/commit/3157bab43f35b095d434ddc7b2097ecc43da7e4a))
* enhance session management with subagent support ([2a28789](https://github.com/bead-ai/zeitlich/commit/2a28789c7a0ea50355f14e2f1d43a584c8b3e636))
* enhance tool handler context and update file operations ([dbc4c70](https://github.com/bead-ai/zeitlich/commit/dbc4c7024800473de095fb2a91b5cbc1df606765))
* in bashTool, allow only  argument instead of ([84e0817](https://github.com/bead-ai/zeitlich/commit/84e08173f53b61eccef38b578018956b4e3d4f11))
* in bashTool, allow only `fs` argument instead of `bashTools` ([0c0c484](https://github.com/bead-ai/zeitlich/commit/0c0c484e78084f877c89ea3e287bd9a4258a8db9))
* move tool scharing into state update call ([513daa2](https://github.com/bead-ai/zeitlich/commit/513daa27a1724991d332815cf66c3932907ede88))
* simplify agent invocation and enhance tool management in workflows ([4ae1cb6](https://github.com/bead-ai/zeitlich/commit/4ae1cb60c479a9043a295e34dbaf5f6a95f231cf))
* simplify agent state manager configuration ([54a4f11](https://github.com/bead-ai/zeitlich/commit/54a4f1147cc5c1d76ca4dab7a5425125e5b5170b))
* update file handling and tool interfaces for dynamic file trees ([177b63b](https://github.com/bead-ai/zeitlich/commit/177b63b283f42ad704b898bcec6c83dc97f24b18))
* update file tree generation to use optional config ([1117e9f](https://github.com/bead-ai/zeitlich/commit/1117e9f12c5983cf2da1fdd05225e47039b024c1))
* update tool imports and enhance tool-router structure ([e76cba5](https://github.com/bead-ai/zeitlich/commit/e76cba5dfe9ac19286846b7c31198bd7f20388f5))


### Documentation

* add release readme ([b62cd60](https://github.com/bead-ai/zeitlich/commit/b62cd6000ae695fc93114f81307d73c74c96590d))

## [0.1.1](https://github.com/bead-ai/zeitlich/compare/v0.1.0...v0.1.1) (2026-02-03)


### Bug Fixes

* configure release-please tag format ([64f745b](https://github.com/bead-ai/zeitlich/commit/64f745b73f17700780ceeb99db47587ee03380a6))

## [0.1.0](https://github.com/bead-ai/zeitlich/releases/tag/v0.1.0) - Initial Release

### Features

- Initial release of zeitlich - an opinionated AI agent implementation for Temporal
- Core session management with `Session` class
- Built-in tools: read, write, edit, glob, grep, task, ask-user-question
- Redis-based state management for durable execution
- Subagent support for parallel task execution
- LangChain integration for model invocation
