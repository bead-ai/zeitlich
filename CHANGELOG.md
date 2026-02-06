# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0](https://github.com/bead-ai/zeitlich/compare/v0.2.0...v0.3.0) (2026-02-06)


### Features

* extend bashTool options, make `fs` required at least ([673e69b](https://github.com/bead-ai/zeitlich/commit/673e69bf3215cde873bebc2881876da9f7079f16))
* increase max string length in BashTool 10-&gt;50mb ([87ceaf8](https://github.com/bead-ai/zeitlich/commit/87ceaf89800b163505f517a5ee7c62be4ed59037))

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
