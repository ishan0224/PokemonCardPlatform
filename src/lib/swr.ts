"use client";

import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";
import useSWRInfinite, {
  type SWRInfiniteConfiguration,
  type SWRInfiniteResponse
} from "swr/infinite";

export type ApiSWRKey<P = unknown> = readonly [resource: string, params?: P];

export type ApiSWRFetcher<P, T> = (params: P) => Promise<T>;

function resolveParams<P>(params: P | undefined): P {
  return (params ?? ({} as P)) as P;
}

export function createApiKey<P = undefined>(resource: string, params?: P): ApiSWRKey<P> {
  return [resource, params] as const;
}

export async function swrFetcher<P, T>(
  key: ApiSWRKey<P>,
  fetcher: ApiSWRFetcher<P, T>
): Promise<T> {
  const [, params] = key;
  return fetcher(resolveParams(params));
}

export function useApiSWR<P, T>(
  key: ApiSWRKey<P> | null,
  fetcher: ApiSWRFetcher<P, T>,
  config?: SWRConfiguration<T, Error>
): SWRResponse<T, Error> {
  return useSWR<T, Error, ApiSWRKey<P> | null>(
    key,
    async (resolvedKey) => swrFetcher(resolvedKey, fetcher),
    config
  );
}

export function useApiSWRInfinite<P, T>(
  getKey: (index: number, previousPageData: T | null) => ApiSWRKey<P> | null,
  fetcher: ApiSWRFetcher<P, T>,
  config?: SWRInfiniteConfiguration<T, Error>
): SWRInfiniteResponse<T, Error> {
  return useSWRInfinite<T, Error>(
    getKey,
    async (resolvedKey: ApiSWRKey<P>) => swrFetcher(resolvedKey, fetcher),
    config
  );
}

export const swrKeys = {
  auth: {
    me: () => createApiKey("auth:me")
  },
  drops: {
    list: (input: { limit?: number } = {}) => createApiKey("drops:list", input),
    detail: (dropId: string) => createApiKey("drops:detail", { dropId })
  },
  collection: {
    list: (input: { rarity?: string | null; state?: string | null; sort?: string; page?: number; limit?: number }) =>
      createApiKey("collection:list", input),
    portfolio: () => createApiKey("collection:portfolio")
  },
  marketplace: {
    list: (input: { rarity?: string | null; sort?: string; page?: number; limit?: number }) =>
      createApiKey("marketplace:list", input)
  },
  auctions: {
    list: (input: { page?: number; limit?: number } = {}) => createApiKey("auctions:list", input),
    detail: (auctionId: string) => createApiKey("auctions:detail", { auctionId })
  },
  packs: {
    my: (input: { opened?: boolean | null; cursor?: string | null; limit?: number }) =>
      createApiKey("packs:my:infinite", input)
  },
  fairness: {
    myPacks: (input: { date?: string | null; dropId?: string | null; cursor?: string | null; limit?: number }) =>
      createApiKey("fairness:my-packs", input)
  }
} as const;
