// Entry for the browser build of the official Anthropic SDK (see the Makefile's
// build/libs/anthropic target). The shell's scripts aren't modules, so the
// client is exposed as a global for Assistant.ts.
import Anthropic from "@anthropic-ai/sdk";

globalThis.Anthropic = Anthropic;
