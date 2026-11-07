---
layout: post
title: "Unreal Engine GPU Stack: Prologue"
description: Why I went down the rabbit hole of Unreal Engine's GPU side, and what this series on compute, RHI, RDG, interop and inference will cover.
tags: [unrealengine, gamedev, gpu, graphics]
cover_image: https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/yxi4o3suxnjnneyeqhwd.png
---

## 1. First contact: The frame that fell apart

The problem that started this for me was simple. A couple of years ago, I was required to process a lot of data every frame. There was a specific algorithm that I wanted to run on every pixel of each video frame the system received, within a certain timeframe, let's say 20ms.

The obvious approach was the one every Unreal Engine developer reaches for first: loop over the frame's pixel array in `Tick`, do the calculations, move on. At a few thousand pixels, it was fine. At a few hundred thousand, it was noticeable. Pushing toward 8.3 million pixels, the frame time fell apart. Multithreading could only help so much.

Running `stat unit` made the problem clear enough. The Game thread was the one blowing the budget, while the GPU was comfortably idle. Unreal Insights confirmed it.. the time was spent in my update loop, doing the same small piece of math for every pixel, one after another.

That's a workload the GPU is built for. So I moved the update into a compute shader, kept the data on the GPU, and profiled again.

The result is the kind of before-and-after (**7 FPS to 65 FPS on an RTX 3080**) that makes GPU programming look like magic. It isn't. Getting there raised more questions than it answered. Why exactly was it faster? What was Unreal doing with my shader between dispatch and screen? Searching for answers to these questions led me down a deeper rabbit hole into Unreal Engine's GPU side.

That rabbit hole meant hours of deep dives into Unreal Engine source code, since content on this topic is very scarce on the web. I had to go on many side quests, digging into much lower-level graphics APIs like DirectX, OpenGL and sometimes Vulkan. Many concepts from CUDA translated very well while writing compute shaders. Random Chinese blog posts proved to be really good reference points in this odyssey.

Even now, there is still no single good source of information that answers all the questions I had a few years ago.

This series is my attempt to answer those questions properly.

## 2. Why the GPU stack and not graphics programming?

Graphics programming is about producing images. The GPU stack covers everything that runs on the GPU: compute, data movement, interop and inference. Generating synthetic sensor data is a good example. It needs physics calculations on the GPU that read vertex buffers already living there, plus uploads and readbacks that stay in sync with the frame.

## 3. Graphics and AI are converging

The GPU in a modern game isn't only rendering triangles anymore. Neural rendering is already shipping: DLSS 5, XeSS and newer versions of FSR use neural networks for upscaling, frame generation reconstructs whole frames, and ray reconstruction and neural denoising replace hand-tuned filters. Behind those, research is moving quickly toward neural materials, neural texture compression, Gaussian splatting, learned radiance caches, world models, and ML-driven animation and physics.

What surprised me was how much of this ends up running on the same GPU, using the same memory and fighting for the same frame budget as the renderer. Once you look past the terminology, the overlap is large. A tensor is a buffer. Running inference is dispatching compute work. Moving data between CPU and GPU costs the same whether it's vertex positions or model weights. The engineer who understands how a frame moves through the GPU is in a good position for both real-time graphics and on-device AI, which is why this series includes a chapter on inference inside the engine rather than treating it as a separate topic.

## 4. Who is this for?

*The same problem looks different depending on where you come from.*

Who hits this wall, and how, varies a lot.

**If you're a gameplay programmer**, it usually shows up as a system that stops scaling. Crowds, projectiles, destruction or simulation work fine until the object count grows, and then `Tick` and Blueprint loops become the bottleneck. The hard part isn't writing a shader. It's moving the system to the GPU without breaking the gameplay logic that depends on it.

**If you're a general software engineer**, you might be looking to build a non-gaming software extension or layer with Unreal. The GPU is best understood as a massively parallel processor. The ideas are the same as in CUDA or an ML framework.. batch the work, keep data on the device, avoid round trips. What's different in a game engine is the strict frame budget and the fact that you share the GPU with a renderer that has its own opinions.

**If you're a technical artist**, the wall is the edge of the material editor. You can see why an effect is expensive but not what's happening beneath the nodes, and some ideas simply can't be expressed as a graph. You might find answers to questions like: Why does adding a Scene Capture Component to the level eat up so much FPS? How can I optimize my work? The short answer is that a scene capture renders the scene again from another view, so all the rendering pipeline calculations and dependencies have to be redone.

**And if you're a graphics programmer** coming from Vulkan, DirectX 12 or OpenGL, you already understand the GPU. The challenge is mapping that knowledge onto Unreal's abstractions, which don't always look like the APIs you know.

This series tries to serve all four, starting from the problem rather than from the API.

## 5. Vibe coding without understanding internals


![Image description](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/g0vpyz2mokna5rateiia.png)


![Image description](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/vgnpf6hdml20pnbr1pa7.png)


AI assistants can produce a compute shader, a render pass or a Scene View Extension in seconds. That's genuinely useful, and I started to use them recently after a bit of reluctance. But GPU code in Unreal is an especially easy place for generated code to go wrong. Recently, while building a GPU-accelerated data processing pipeline, I prompted Claude Fable with a good amount of context to build the system. It wrote the code for me, the code compiled, and everything worked fine. But when I profiled the system, I found that a specific part of it was taking **7.5ms by blocking the game thread**. After searching through a few hundred lines of code, I found a particular line where `FlushRenderingCommands()` was used, which was unnecessary for this design. `FRHIGPUFence` would have worked better (I'll explain why in the following chapters). With a simple prompt to rework the system to use `FRHIGPUFence` properly instead of `FlushRenderingCommands()`, I was able to cut the processing time on the game thread for that system from **7.5ms to 2.3ms**.

Part of the reason is specific to Unreal.. its rendering APIs change between 5.x releases. Functions get renamed, deprecated or moved, and the model's training data contains all of those versions at once. The generated code often mixes an older pattern with a newer one, and the result may or may not compile.

The more dangerous case is when it does compile. **Code that compiles is not the same as code that works.** A render pass can build cleanly and output a black screen. A readback can work perfectly and quietly stall the frame. Each of those looks like one symptom but has a different root cause, and without a mental model of the layers underneath, you can't tell which one you're looking at. Worse, you can't tell a correct answer from a confident wrong one.

## 6. The OpenGL vs Unreal beginner's dilemma

Experts often suggest going with OpenGL as your first graphics API to learn the concepts. While cross-referencing a lot of rendering content from OpenGL, I had a big decision to make. As a beginner, I found that OpenGL had easily available learning resources, while Unreal's were scarce and the learning curve was steep. As a person with a toxic habit of doing things the difficult way, I chose Unreal, and after a few months, I had a realization.

The realization that changed my approach was that **Unreal already is a graphics library**. The RHI (Render Hardware Interface) is an abstraction over D3D12, Vulkan and Metal. The Render Dependency Graph (RDG) sits on top of it and manages resources and passes. The question isn't whether to use a graphics library. It's whether to learn the one already shipping in the engine.

If you already know Unreal Engine, go with it as your graphics library using this series as learning material, since it's easier to build games and projects when the rest of the tooling is already available. If you're starting from the beginning without any game engine experience, I'd probably start with OpenGL.

## 7. What this series covers

Each chapter starts from a problem and builds a solution on the GPU. The chapters roughly follow the order in which I had to learn things, from the fundamentals of how Unreal renders a frame, to running neural networks inside it.

1. **GPU world building and context setup.** The foundations the rest of the series builds on: rendering fundamentals, the Game, Render and RHI threads, and what RHI and RDG actually do.
2. **Scene View Extensions.** How to inject your own rendering pass into Unreal's frame without modifying the engine.
3. **Compute shaders.** Writing a shader in a plugin, dispatching it through the Render Dependency Graph, and running general-purpose work on the GPU.
4. **CPU-GPU data upload and readback.** Getting data onto the GPU and results back, and why a readback that works can still stall the frame.
5. **Combining compute, vertex and pixel shaders for particle effects.** Simulating on the GPU with compute and drawing the results without ever copying them back to the CPU.
6. **GPU mesh and a custom mesh pipeline.** How Unreal actually draws a mesh, through scene proxies, vertex factories and mesh batches, and how to build your own.
7. **GPU vertex animation.** Animating thousands of meshes by doing the work in the vertex pipeline.
8. **GPU physics.** Running simulation on the GPU, and the problems that appear when gameplay needs to know the results.
9. **GPU-accelerated cross-API interoperability.** Sharing GPU memory between Unreal and other APIs, using video streaming as the example.
10. **GPU-accelerated AI inference.** Running neural networks inside the engine, on the same GPU and within the same frame budget as the renderer.
11. **Profiling and debugging.** Unreal Insights, GPU profiling, RenderDoc and RDG's debugging tools, and how to tell whether something is actually faster and why, or why it isn't running at all. It's listed last, but it's worth reading whenever the numbers stop making sense.

**Epilogue: What's next.** Where this leads, what's possible, and projects and examples worth studying.

---

If you have questions along the way, send them. They'll shape the FAQ at the end of future chapters.
