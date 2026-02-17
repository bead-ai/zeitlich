# Changelog

All notable changes to this project will be documented in this file.

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
