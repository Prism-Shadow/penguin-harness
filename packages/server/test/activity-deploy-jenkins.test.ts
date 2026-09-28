/**
 * The deploy's Jenkins client against a fake `fetch`: a job is started with its parameters (a
 * crumb fetched once when Jenkins asks for one), a build is found by those parameters and never
 * mistaken for an older one, and no error carries the token. Nothing reaches a network.
 */
import { describe, expect, it } from "vitest";
import {
  JenkinsError,
  carriesParameters,
  createDeployJenkins,
  type JenkinsFetch,
  type JenkinsRequestInit,
} from "../src/activities/deploy-jenkins.js";

const TOKEN = "very-secret-token";
const TARGET = { url: "https://jenkins.example.org/", username: "robot", token: TOKEN };
const PARAMS = { Modules: "words loom/words-deploy" };

interface Call {
  url: string;
  init: JenkinsRequestInit;
}

function respond(status: number, body: unknown = "", headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function fakeFetch(answer: (call: Call, index: number) => ReturnType<typeof respond>) {
  const calls: Call[] = [];
  const request: JenkinsFetch = async (url, init) => {
    calls.push({ url, init });
    return answer({ url, init }, calls.length - 1);
  };
  return { calls, request };
}

describe("deploy Jenkins client", () => {
  it("starts a job with its parameters as a form, with Basic auth", async () => {
    const fake = fakeFetch(() =>
      respond(201, "", { location: "https://jenkins.example.org/queue/item/7/" }),
    );
    const jenkins = createDeployJenkins(TARGET, fake.request);
    const result = await jenkins.trigger("Build WAF Modules", PARAMS);
    expect(result.queueUrl).toBe("https://jenkins.example.org/queue/item/7/");
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call!.url).toBe(
      "https://jenkins.example.org/job/Build%20WAF%20Modules/buildWithParameters",
    );
    expect(call!.init.method).toBe("POST");
    expect(call!.init.body).toBe("Modules=words+loom%2Fwords-deploy");
    expect(call!.init.headers.Authorization).toBe(
      `Basic ${Buffer.from(`robot:${TOKEN}`).toString("base64")}`,
    );
  });

  it("fetches a crumb once when Jenkins refuses for the crumb, and retries with it", async () => {
    const fake = fakeFetch((call, index) => {
      if (index === 0) return respond(403, "No valid crumb was included in the request");
      if (call.url.endsWith("/crumbIssuer/api/json"))
        return respond(200, { crumbRequestField: "Jenkins-Crumb", crumb: "abc" });
      return respond(201);
    });
    const jenkins = createDeployJenkins(TARGET, fake.request);
    await jenkins.trigger("Build WAF Modules", PARAMS);
    expect(fake.calls.map((call) => call.url)).toEqual([
      "https://jenkins.example.org/job/Build%20WAF%20Modules/buildWithParameters",
      "https://jenkins.example.org/crumbIssuer/api/json",
      "https://jenkins.example.org/job/Build%20WAF%20Modules/buildWithParameters",
    ]);
    expect(fake.calls[2]!.init.headers["Jenkins-Crumb"]).toBe("abc");
  });

  it("does not retry a 403 that is not about the crumb, nor a second crumb refusal", async () => {
    const denied = fakeFetch(() => respond(403, "Forbidden"));
    await expect(
      createDeployJenkins(TARGET, denied.request).trigger("job", PARAMS),
    ).rejects.toMatchObject({ status: 403 });
    expect(denied.calls).toHaveLength(1);

    const twice = fakeFetch((call) =>
      call.url.endsWith("/crumbIssuer/api/json")
        ? respond(200, { crumbRequestField: "Jenkins-Crumb", crumb: "abc" })
        : respond(403, "crumb invalid"),
    );
    await expect(
      createDeployJenkins(TARGET, twice.request).trigger("job", PARAMS),
    ).rejects.toBeInstanceOf(JenkinsError);
    expect(twice.calls).toHaveLength(3);
  });

  it("finds a queued item by its parameters", async () => {
    const fake = fakeFetch((call) =>
      call.url.includes("/queue/")
        ? respond(200, {
            items: [
              {
                url: "queue/item/6/",
                actions: [{ parameters: [{ name: "Modules", value: "other main" }] }],
              },
              {
                url: "queue/item/7/",
                actions: [{}, { parameters: [{ name: "Modules", value: PARAMS.Modules }] }],
              },
            ],
          })
        : respond(500),
    );
    const status = await createDeployJenkins(TARGET, fake.request).status("job", PARAMS);
    expect(status).toEqual({ state: "queued", url: "https://jenkins.example.org/queue/item/7/" });
  });

  it("finds the newest build with the parameters, passing over those from before the trigger", async () => {
    const builds = [
      {
        number: 12,
        url: "job/x/12/",
        building: false,
        result: "SUCCESS",
        actions: [{ parameters: [{ name: "Modules", value: "other main" }] }],
      },
      {
        number: 11,
        url: "job/x/11/",
        building: true,
        result: null,
        actions: [{ parameters: [{ name: "Modules", value: PARAMS.Modules }] }],
      },
      {
        number: 9,
        url: "job/x/9/",
        building: false,
        result: "FAILURE",
        actions: [{ parameters: [{ name: "Modules", value: PARAMS.Modules }] }],
      },
    ];
    const fake = fakeFetch((call) =>
      call.url.includes("/queue/") ? respond(200, { items: [] }) : respond(200, { builds }),
    );
    const jenkins = createDeployJenkins(TARGET, fake.request);
    expect(await jenkins.status("job", PARAMS)).toEqual({
      state: "building",
      number: 11,
      url: "https://jenkins.example.org/job/x/11/",
    });
    // Before the trigger, #11 was the newest: it is not the new build.
    expect(await jenkins.status("job", PARAMS, { after: 11 })).toEqual({ state: "unknown" });
    builds[1]!.building = false;
    builds[1]!.result = "ABORTED";
    expect(await jenkins.status("job", PARAMS, { after: 9 })).toMatchObject({
      state: "failed",
      result: "ABORTED",
      number: 11,
    });
    expect(fake.calls.at(-1)!.url).toBe(
      "https://jenkins.example.org/job/job/api/json?tree=builds[number,url,building,result,actions[parameters[name,value]]]",
    );
  });

  // Before a trigger, a matching item already in the queue has no number yet: the floor the
  // new build is found above is the newest build Jenkins has, or an older success could pass.
  it("passes over the queue when asked, for the newest build before a trigger", async () => {
    const fake = fakeFetch((call) =>
      call.url.includes("/queue/")
        ? respond(200, {
            items: [
              {
                url: "queue/item/7/",
                actions: [{ parameters: [{ name: "Modules", value: PARAMS.Modules }] }],
              },
            ],
          })
        : respond(200, {
            builds: [
              {
                number: 9,
                url: "job/x/9/",
                building: false,
                result: "SUCCESS",
                actions: [{ parameters: [{ name: "Modules", value: PARAMS.Modules }] }],
              },
            ],
          }),
    );
    const jenkins = createDeployJenkins(TARGET, fake.request);
    expect(await jenkins.status("job", PARAMS, { skipQueue: true })).toMatchObject({
      state: "succeeded",
      number: 9,
    });
    expect(fake.calls.some((call) => call.url.includes("/queue/"))).toBe(false);
  });

  it("keeps only a web address for a build's page", async () => {
    const fake = fakeFetch((call) =>
      call.url.includes("/queue/")
        ? respond(200, {
            items: [
              {
                url: "javascript:alert(1)",
                actions: [{ parameters: [{ name: "Modules", value: PARAMS.Modules }] }],
              },
            ],
          })
        : respond(500),
    );
    expect(await createDeployJenkins(TARGET, fake.request).status("job", PARAMS)).toEqual({
      state: "queued",
    });
  });

  it("matches a parameter on any line of a multi-line value", () => {
    const actions = [
      { parameters: [{ name: "Modules", value: `other main\n${PARAMS.Modules}\n` }] },
    ];
    expect(carriesParameters(actions, PARAMS)).toBe(true);
    expect(carriesParameters(actions, { Modules: "words" })).toBe(false);
    expect(carriesParameters(null, PARAMS)).toBe(false);
  });

  it("never puts the token in an error", async () => {
    const failures: Array<[JenkinsFetch, boolean]> = [
      [
        async () => {
          throw new Error(`connect failed with Authorization: Basic ${TOKEN}`);
        },
        true,
      ],
      [async () => respond(500, `internal error ${TOKEN}`), true],
      // A trigger reads no body; only a status read fails on one that is not JSON.
      [async () => respond(200, "not json"), false],
    ];
    for (const [request, triggerFails] of failures) {
      const jenkins = createDeployJenkins(TARGET, request);
      const calls = [() => jenkins.status("job", PARAMS)];
      if (triggerFails) calls.push(() => jenkins.trigger("job", PARAMS) as never);
      for (const call of calls) {
        const error = await call().then(
          () => null,
          (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(JenkinsError);
        const text = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain(Buffer.from(`robot:${TOKEN}`).toString("base64"));
      }
    }
  });
});
