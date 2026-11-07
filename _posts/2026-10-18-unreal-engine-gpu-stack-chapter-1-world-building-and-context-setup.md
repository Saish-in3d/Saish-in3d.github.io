---
layout: post
title: "Unreal Engine GPU Stack: Chapter 1 World Building and Context Setup"
tags: [unrealengine, gamedev, gpu, graphics]
cover_image: https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/x4zm6xlo1ps7fsfpu2ph.png
---

In the prologue, moving a per-pixel workload from Tick into a compute shader took a scene from 7 FPS to 65 FPS. That result worked. What it didn't give me was an explanation. It was a Blackbox for me. I knew the shader ran, but I couldn't say which thread dispatched it, when it actually executed on the GPU.

Before writing more GPU code, I needed some kind of a world context building. What happens between "I changed a value on an actor" and "a pixel changed on screen"? What's happening inside at a lower level?

This chapter builds that world along with fundamentals. There isn't much shader code here. The goal is to have a mental model solid enough that when something goes wrong in later chapters, you can guess where it went wrong.

## 1. Bit of high school level of boring history for better context
Initially, the CPU did all the math (SISD) needed to draw graphics. It worked, but became too slow as graphics got more complex.

People realized that graphics requires doing the "same calculations many times with different data on different threads" (SIMT) ( moving vertices, multiplying matrices, calculating pixels, and so on). So they built specialized hardware that could do many of these calculations "at the same time".

That specialized hardware eventually became what we know today as "GPUs".

<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/ZrJeYFxpUyQ" title="YouTube video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

### 1.1 The narrative SISD vs SIMD vs SIMT
**SISD (Single Instruction, Single Data):** One instruction works on one piece of data at a time. This is the classic scalar CPU model... add two numbers, then the next two, then the next.

**SIMD (Single Instruction, Multiple Data):** One instruction works on a small fixed-width vector of data at once, such as 4, 8 or 16 floats with SIMD units on a CPU. You (or the compiler) pack the data into vector registers explicitly. (registers are the most smallest, fastest and closest data storage to core or hardware that does compute)

**SIMT (Single Instruction, Multiple Threads):** The GPU's model. Threads aren't scheduled individually. They're bundled into groups of 32 (a *warp* on NVIDIA) or 32/64 (a *wavefront* on AMD), and every thread in the group executes the same instruction at the same time, each on its own data. You write the shader as if it were one thread handling one pixel, and the hardware runs it 32 or 64 at a time.

![SISD vs SIMD vs SIMT](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/m3hrvucabs8ywwaxeote.png)


## 2. Character building: Understanding the hardware and its workings technically, CPU, GPU and PCIe bridge
Before looking at Unreal's graphics system, it helps to know what they are ultimately feeding. A CPU and a GPU are both processors that fetch instructions and do math on data, but they were built for different purposes. The CPU is built to finish one task as fast as possible. The GPU is built to finish as many tasks as possible in a given time. 

### 2.1 The CPU: optimized for latency
A modern desktop CPU has somewhere between 8 and 24 physical cores, running at roughly 4 to 6 GHz. Each core is a very complex machine. It predicts which way branches will go before they're evaluated, reorders and schedules instructions so independent work runs while it waits on slow work, and runs several instructions per clock cycle in a single core through multiple execution sub units.

Most of that complex stuff above exists to hide one problem: memory is slow. Reading from main memory takes around 70 to 100 nanoseconds, which is several hundred clock cycles staying idle. So CPUs has dedicated hardware for caches.

![CPU memory hierarchy](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/rb4ip9j8hblun4ocldts.png)

Data moves between these levels in 64-byte cache lines, not individual values (like tetris but all blocks are horizontal lines). Read one float and its fifteen neighbors come along for free. Code that reads memory in order gets that benefit, while code that jumps around (pointer chasing through randomly spawned actors and components, for example) keeps paying the full trip to DRAM.

The CPU is great at branchy, unpredictable, serial logic i.e. gameplay, AI, physics queries, the scene management the Render thread does. But it doesn't have width. Eight cores with 8-wide SIMD compute unit gives you roughly 64 floats being processed per cycle at best. A 4k image has just over eight million pixels. That's the workload from the prologue, and that's why it hit a wall.

### 2.2 The GPU: optimised for throughput
A GPU does things differently. It runs at lower clocks, roughly 1.5 to 2.8 GHz, and each individual core is simple... no branch prediction like CPU, small caches per core. Instead what it has  is **a huge number of small parallel computing units**. Modern highend GPUs have thousands of them, grouped into larger units such as **Streaming Multiprocessors (NVIDIA)** or **Compute Units (AMD)**. This lets them run **tens of thousands of threads at the same time**.

A modern GPU is more than just thousands of compute cores. It contains different types of hardware, each designed for a specific kind of work. **CUDA/Shader cores** handle general calculations and graphics, **Tensor Cores** accelerate AI and matrix operations, **RT Cores** speed up ray tracing, while dedicated hardware handles tasks like video encoding, decoding, and data transfers. Together, these specialised parts make GPUs efficient at handling many different workloads in parallel.

All of this just to achieve SIMT! 

Few questions that clears the fog about GPU, streaming multiprocessors and warps/wavefont.

1. is a streaming multiprocessor actual hardware on GPU? Yes. A Streaming Multiprocessor (SM) is an actual physical hardware block inside an NVIDIA GPU. it is structured like this.
   ![Streaming Multiprocessor layout](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/5i4rpfk5a7dhc5mky9sl.png)

2. is warp  just a driver level abstraction?
   No. A warp is basically a GPU hardware/architecture concept, exposed to programmers through programming. There is a specific warp scheduler hardware (orange in above pic) that handles thread allocation. If a SM has 1024 threads then it can 32 warps.
   
3. can a warp contain threads from two different SM?
   No. A warp stays entirely on one SM.
   
4. does rendering and compute shaders run on same SM's?
   Yes. Graphics shaders and compute shaders generally use the same SMs/execution resources on a GPU. Although there is dedicated hardware to perform some fixed function operations.
   
   
   There are more nuances to this, we will address them in detail when we cover compute shaders in future chapters.



### 2.3 The bridge: PCIe
On a desktop PC, the CPU and a discrete GPU are separate devices with separate memory, connected by PCI Express. This is the narrowest pipe in the whole system.

![PCIe bandwidth](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/6x9653y75loktzzzclgo.png)

A 4K render target in a 16-bit float format is about 66 MB. Copying it across PCIe 4.0 takes around 2.6 ms, roughly 16% of a 60 FPS frame budget, before the GPU has done any work on it. The same texture read from VRAM by a shader is a lot cheaper. The lesson is simple... data should cross the bus as rarely as possible. Upload once, keep it on the GPU, and only bring results back when something on the CPU truly needs them.

Bandwidth is not the only cost. Every transfer and every dispatch also has fixed overhead... driver work, command submission, synchronization. For small workloads that overhead dominates, which is why a tiny compute shader can end up slower than doing the same work on the CPU.

It's also why the two processors don't talk to each other directly. The CPU writes commands into a buffer, and the GPU consumes that buffer later, usually a frame or more behind. Asking the GPU for an answer "right now" means the CPU has to stop and wait for the GPU to catch up, and the GPU sits idle until the CPU gives it more work. That's the same stall that shows up later as `FlushRenderingCommands()` and as naive readback, and the whole thread architecture in the next section exists to avoid it.

Not every platform works like this. Consoles, Apple Silicon and most mobile chips use **unified memory**, where CPU and GPU share the same physical RAM. There's no PCIe copy, but they compete for the same bandwidth (most likely unified memories have lower speeds than dedicated vram and HBMs). Mobile GPUs also usually use **tile-based rendering**, which processes the screen in small tiles held in on-chip memory. That changes which techniques are cheap and which are expensive. This series targets desktop hardware, but it's worth remembering that "the GPU" is not one architecture.

## 3. Three threads and a few transfers
The first thing that changed how I read Unreal's rendering code was realising that a frame isn't produced by one thread. There are literally three threads involved.

The **Game thread** runs gameplay... actors tick, components update, Blueprints execute (something similar to updating UBO info in Vulkan terms). The **Render thread** takes the resulting scene state and decides what to draw and in what order (Holds and manages vertex proxies or host(cpu) native/ staging VBO in vulkan terms). The **RHI thread** translates those decisions into actual D3D12, Vulkan or Metal commands and submits them to the driver. The GPU then executes them on its own schedule.

These threads are pipelined, not synchronised step by step. While the Render thread is building frame N, the Game thread is usually already working on frame N+1, and the GPU may still be finishing frame N-1. That overlap is where most of the engine's throughput comes from, and it's also where most of the confusing bugs come from.

![Game, Render and RHI thread pipelining](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/dgvnjtjnz1xnbcypru2g.png)

The consequence is that the Game thread can't simply reach into the renderer and change things. Any data the renderer needs has to be handed over, and the Game thread has to keep going without waiting. Unreal does this in two ways.

For components that draw something, the transfer is a **scene proxy**. A `UPrimitiveComponent` creates a render-thread-owned copy of the state needed to draw it, generally a subclass of `FPrimitiveSceneProxy`. When the component's transform or render state changes, the engine pushes an update to that proxy instead of letting the renderer read the component directly. The renderer only ever sees proxies. That separation is why a component can be garbage-collected on the Game thread while its last frame is still being drawn.

For everything else, there's `ENQUEUE_RENDER_COMMAND`, which queues a lambda to run on the Render thread at some later point.

```cpp
const FLinearColor Tint = ComputeTintOnGameThread();

ENQUEUE_RENDER_COMMAND(UpdateMyTint)(
    [Proxy = MyProxy, Tint](FRHICommandListImmediate& RHICmdList)
    {
        // Runs on the Render thread, possibly a frame or more later.
        Proxy->SetTint_RenderThread(Tint);
    });
```

The important detail is the capture list. The lambda runs after the calling function has returned, so anything captured by reference is likely gone by then. Capturing by value, or moving data into the lambda, is what actually carries the state across the thread boundary. Sometimes if you are sure that a really large object wont be garbage collected or killed or accessed by the game thread, you can just pass it as reference inside the lambda. It's unsafe but we cut overhead of creating a copy of the object.

This is also where the problem from the prologue came from. `FlushRenderingCommands()` makes the Game thread wait until the Render thread has processed everything queued so far. It's a correct way to get a consistent view of render state, which is why AI generated code reaches for it. But it collapses the pipeline... for as long as the flush takes, the Game thread and the Render thread are no longer overlapping. That was the 7.5ms. It wasn't a bug in terms of output. It was a design flaw that was correct and slow at the same time.

## 4. Unreal is already a graphics library
Unreal allows us to declare and do GPU calls which is similar to any low level graphics library but is abstracted by two layers. This is very similar to WGPU as Unreal's graphics library translates calls into native low-level GPU drivers like Vulkan, Metal, DirectX 12, or WEB GPU (some people have already done it!). 

Once the data reaches the Render thread, it goes through two abstraction layers before it becomes GPU work. 

The lower one is the **RHI**, the Render Hardware Interface. It's Unreal's portable graphics API... textures, buffers, shaders, pipeline state, draw and dispatch calls, expressed once and implemented per backend. Code talks to the RHI mostly through command lists (`FRHICommandList`), which record commands that the RHI thread later translates into native API calls. Each RHI also reports a feature level, such as SM5, SM6 or ES3_1 for mobile, which decides what the hardware can be asked to do. That matters a lot once compute shaders enter the picture.

Working directly at the RHI level feels familiar if you come from Vulkan or D3D12, and it comes with the same responsibilities. You create the resources, you track their lifetimes, and you issue the transitions that tell the GPU a texture is moving from "being written" to "being read."

The layer above it is the **Render Dependency Graph (RDG)**, and this is where most modern rendering code in Unreal actually lives. Instead of issuing commands immediately, you describe a frame's worth of work as a graph of passes. Each pass declares, through its parameter struct, which resources it reads and which it writes.

So the stack looks like this

![Unreal render stack](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/1yhxihf20yyes6xdrqfe.png)

This is the realisation I mentioned in the prologue. The question isn't whether to use a graphics library in Unreal. The RHI and RDG already are one. The work is learning its rules.

## 5. Why all this matters?
This chapter didn't add a single line of shader code, but it changed how I and you will read the problems that came later. "My shader doesn't run" stopped being one problem and became several... the shader wasn't found, the pass was culled or the resource was never transitioned, or maybe the result was read before the GPU produced it. Each of those lives in a different layer, and knowing the layers is what makes it possible to tell them apart.

It also changed how I use AI-generated rendering code. The model can write a pass quickly. What I have is is the ability to ask which thread that pass runs on, what it waits for, and whether the profile agrees with what the ai generated code claims to do.

The next chapter uses this world to read an existing plugin... `GPUCompositionGraphicsPipeline`, which composites a media texture into the rendered frame. Where does it enter the frame, which thread does each part run on, and why is the work declared as passes instead of issued as draw calls?