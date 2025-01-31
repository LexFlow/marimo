/* Copyright 2024 Marimo. All rights reserved. */
import "./islands.css";
import "iconify-icon";

import { initializePlugins } from "@/plugins/plugins";
import { createMarimoFile, parseMarimoIslandApps } from "./parse";
import { IslandsPyodideBridge } from "./bridge";
import { store } from "../state/jotai";
import {
  createNotebookActions,
  notebookAtom,
  notebookReducer,
} from "../cells/cells";
import { toast } from "@/components/ui/use-toast";
import { renderHTML } from "@/plugins/core/RenderHTML";
import { logNever } from "@/utils/assertNever";
import { jsonParseWithSpecialChar } from "@/utils/json/json-parser";
import { FUNCTIONS_REGISTRY } from "../functions/FunctionRegistry";
import {
  handleKernelReady,
  handleCompletedRun,
  handleInterrupted,
  handleRemoveUIElements,
  handleCellOperation,
} from "../kernel/handlers";
import { queryParamHandlers } from "../kernel/queryParamHandlers";
import { Logger } from "@/utils/Logger";
import { Functions } from "@/utils/functions";
import { defineCustomElement } from "../dom/defineCustomElement";
import { MarimoIslandElement } from "./components/web-components";
import { RuntimeState } from "../kernel/RuntimeState";

/**
 * Main entry point for the js bundle for embedded marimo apps.
 */

/**
 * Initialize the Marimo app.
 */
export async function initialize() {
  // Add 'marimo' class name to all `marimo-island` elements.
  const islands = document.querySelectorAll<HTMLElement>(
    MarimoIslandElement.tagName,
  );
  for (const island of islands) {
    island.classList.add(MarimoIslandElement.styleNamespace);
  }

  // This will display all the static HTML content.
  initializePlugins();

  // Find all "applications" which consist of snippets of code that are inside <marimo-island> tags.
  const apps = parseMarimoIslandApps();

  // Initialize each app
  for (const app of apps) {
    await IslandsPyodideBridge.INSTANCE.startSession({
      code: createMarimoFile(app),
      appId: app.id,
    });
  }

  const actions = createNotebookActions((action) => {
    store.set(notebookAtom, (state) => notebookReducer(state, action));
  });

  // Consume messages from the kernel
  IslandsPyodideBridge.INSTANCE.consumeMessages((message) => {
    const msg = jsonParseWithSpecialChar(message);
    switch (msg.op) {
      case "banner":
      case "missing-package-alert":
      case "installing-package-alert":
      case "completion-result":
      case "reload":
        // Unsupported
        return;
      case "kernel-ready":
        handleKernelReady(msg.data, {
          autoInstantiate: true,
          setCells: actions.setCells,
          setLayoutData: Functions.NOOP,
          setAppConfig: Functions.NOOP,
          onError: Logger.error,
        });
        // Define the custom element for the marimo-island tag.
        // This comes after initializing since this reads from the store.
        defineCustomElement(MarimoIslandElement.tagName, MarimoIslandElement);
        return;
      case "completed-run":
        handleCompletedRun();
        return;
      case "interrupted":
        handleInterrupted();
        return;
      case "remove-ui-elements":
        handleRemoveUIElements(msg.data);
        return;
      case "function-call-result":
        FUNCTIONS_REGISTRY.resolve(msg.data.function_call_id, msg.data);
        return;
      case "cell-op":
        handleCellOperation(msg.data, actions.handleCellMessage);
        return;
      case "variables":
      case "variable-values":
        return;
      case "alert":
        // TODO: support toast with islands
        toast({
          title: msg.data.title,
          description: renderHTML({
            html: msg.data.description,
          }),
          variant: msg.data.variant,
        });
        return;
      case "query-params-append":
        queryParamHandlers.append(msg.data);
        return;
      case "query-params-set":
        queryParamHandlers.set(msg.data);
        return;
      case "query-params-delete":
        queryParamHandlers.delete(msg.data);
        return;
      case "query-params-clear":
        queryParamHandlers.clear();
        return;
      default:
        logNever(msg);
    }
  });

  // Start the runtime
  RuntimeState.INSTANCE.start();
}

initialize();
