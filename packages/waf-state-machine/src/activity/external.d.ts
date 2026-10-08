declare module 'input-manager-system' {
  export const inputManager: {
    initialize(options: { moduleId: string; longPressConfirmDuration?: unknown }): void;
  };
}

declare module 'pubsubsingleton' {
  const pubSubSingleton: { setup(options: { pubSub: WafPubSub }): void };
  export const EVENTS: {
    activity: { end: string; pause: string; resume: string; start: string };
  };
  export default pubSubSingleton;
}

declare module 'waf-utils' {
  export function getPlayOperation(options: { audioPaths: string[]; channel: string }): Record<string, unknown>;
  export function getSpeechPlayOperation(value: Record<string, unknown>): Record<string, unknown>;
  export function isObject(value: unknown): value is Record<string, unknown>;
  export function loadAssets(assets: WafAssetDescriptor[]): Promise<void>;
}

interface WafPubSub {
  publish(event: string, payload?: unknown): void;
  subscribe(event: string, listener: () => void): unknown;
}

interface WafAssetDescriptor {
  asset?: unknown;
  id: string;
  isDefinition?: boolean;
  type: string;
  url: string;
}

declare const Activity: {
  Inspection?: import('./inspection.ts').ActivityInspection;
  Modules: {
    ready(moduleId: string): void;
    register(registration: {
      id: string;
      type: 'html';
      initialize(
        pubSub: WafPubSub,
        declaration: WafDeclaration,
        configuration: Record<string, unknown>,
        user: unknown,
      ): Promise<void>;
    }): void;
  };
};

declare const MODULE_ID: string;

interface WafDeclaration {
  assets: Record<string, WafAssetDescriptor | unknown>;
  properties: Record<string, unknown>;
}
