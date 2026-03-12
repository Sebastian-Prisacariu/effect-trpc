/**
 * E2E Tests with Loopback Transport
 * 
 * Tests Client ↔ Server communication without HTTP.
 * The loopback transport calls Server.handle() directly.
 */

import { Effect, Layer, Stream } from "effect"
import * as Transport from "../../src/Transport/index.js"
import { testServer, TestDatabaseLive, TestDatabase } from "./fixtures.js"
import { e2eSuite } from "./suite.js"

// Simple approach: provide database to server handlers directly in each call
const LoopbackTransportLayer = Layer.succeed(
  Transport.Transport,
  {
    send: (request: Transport.TransportRequest) => 
      testServer.handle(request).pipe(
        Effect.provide(TestDatabaseLive)
      ) as Effect.Effect<Transport.TransportResponse, Transport.TransportError>,
    sendStream: (request: Transport.TransportRequest) => 
      Stream.unwrap(
        Effect.provide(
          Effect.succeed(testServer.handleStream(request)),
          TestDatabaseLive
        )
      ).pipe(
        Stream.provideLayer(TestDatabaseLive)
      ) as Stream.Stream<Transport.StreamResponse, Transport.TransportError>,
  }
)

// Full layer 
const LoopbackLayer = Layer.mergeAll(
  LoopbackTransportLayer,
  TestDatabaseLive
)

// Run the full e2e suite against loopback transport
e2eSuite("Loopback Transport", LoopbackLayer)
