using System;
using System.Collections.Generic;
using PortalVivafrutaz;

namespace PortalVivafrutaz.Tests {
  public sealed class FakeContainedProcessApi : IContainedProcessApi {
    public readonly List<string> Calls = new List<string>();
    public bool FailCreate;
    public bool FailResume;
    public IntPtr ExpectedJob;
    public ProcessHandles CreateSuspended(IntPtr job, string executable, string commandLine, string workingDirectory, IDictionary<string, string> environment) {
      Calls.Add("create-suspended");
      if (job != ExpectedJob) throw new InvalidOperationException("wrong job passed to atomic creation");
      if (FailCreate) throw new InvalidOperationException("CreateProcess/JOB_LIST failed");
      return new ProcessHandles { Process = new IntPtr(101), Thread = new IntPtr(102), ProcessId = 103 };
    }
    public uint ResumeThread(IntPtr thread) {
      Calls.Add("resume");
      if (thread != new IntPtr(102)) throw new InvalidOperationException("wrong primary thread");
      return FailResume ? 0u : 1u;
    }
    public void TerminateProcess(IntPtr process, uint code) { Calls.Add("terminate-owned-handle"); }
    public bool WaitForExit(IntPtr process, uint milliseconds) { Calls.Add("wait"); return true; }
    public uint GetExitCode(IntPtr process) { Calls.Add("exit-code"); return 0; }
    public void CloseHandle(IntPtr handle) { Calls.Add("close:" + handle.ToInt64()); }
  }
}
