import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/shared/ui/primitives";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("Sueño shared primitives", () => {
  it("opens popovers, focuses content, and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger><button type="button">打开筛选</button></PopoverTrigger>
        <PopoverContent aria-label="筛选内容"><input aria-label="搜索" /></PopoverContent>
      </Popover>,
    );

    const trigger = screen.getByRole("button", { name: "打开筛选" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "筛选内容" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜索" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "筛选内容" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes popovers when the pointer lands outside the content", async () => {
    const user = userEvent.setup();
    const outsideClick = vi.fn();
    render(
      <>
        <Popover>
          <PopoverTrigger><button type="button">打开</button></PopoverTrigger>
          <PopoverContent aria-label="菜单"><p>内容</p></PopoverContent>
        </Popover>
        <button type="button" onClick={outsideClick}>外部按钮</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "打开" }));
    await user.click(screen.getByRole("button", { name: "外部按钮" }));
    expect(screen.queryByRole("dialog", { name: "菜单" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).toHaveFocus();
    expect(outsideClick).toHaveBeenCalledOnce();
  });

  it("supports roving keyboard focus for tabs", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="one">
        <TabsList aria-label="视图">
          <TabsTrigger value="one">一</TabsTrigger>
          <TabsTrigger value="two">二</TabsTrigger>
        </TabsList>
        <TabsContent value="one">第一项</TabsContent>
        <TabsContent value="two">第二项</TabsContent>
      </Tabs>,
    );

    const first = screen.getByRole("tab", { name: "一" });
    const second = screen.getByRole("tab", { name: "二" });
    await user.click(second);
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("第二项")).toBeVisible();
    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("restores focus when a sheet or alert dialog closes", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Sheet>
          <SheetTrigger><button type="button">打开面板</button></SheetTrigger>
          <SheetContent aria-label="侧面板"><button type="button">面板动作</button></SheetContent>
        </Sheet>
        <AlertDialog>
          <AlertDialogTrigger><button type="button">打开确认</button></AlertDialogTrigger>
          <AlertDialogContent aria-label="确认操作"><AlertDialogAction>确认</AlertDialogAction></AlertDialogContent>
        </AlertDialog>
      </>,
    );

    const sheetTrigger = screen.getByRole("button", { name: "打开面板" });
    await user.click(sheetTrigger);
    expect(screen.getByRole("dialog", { name: "侧面板" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sheetTrigger).toHaveFocus();

    const alertTrigger = screen.getByRole("button", { name: "打开确认" });
    await user.click(alertTrigger);
    await user.click(screen.getByRole("button", { name: "确认" }));
    expect(screen.queryByRole("alertdialog", { name: "确认操作" })).not.toBeInTheDocument();
    expect(alertTrigger).toHaveFocus();
  });

  it("keeps body scrolling locked until every open sheet closes", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = "scroll";
    render(
      <>
        <Sheet defaultOpen>
          <SheetContent aria-label="左侧面板"><SheetClose>关闭左侧面板</SheetClose></SheetContent>
        </Sheet>
        <Sheet defaultOpen>
          <SheetContent aria-label="右侧面板"><SheetClose>关闭右侧面板</SheetClose></SheetContent>
        </Sheet>
      </>,
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(within(screen.getByRole("dialog", { name: "左侧面板" })).getByRole("button", { name: "关闭左侧面板" }));
    expect(screen.getByRole("dialog", { name: "右侧面板" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "关闭右侧面板" }));
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("does not dismiss an alert dialog from the blocking overlay", async () => {
    const user = userEvent.setup();
    render(
      <AlertDialog>
        <AlertDialogTrigger><button type="button">删除</button></AlertDialogTrigger>
        <AlertDialogContent aria-label="删除确认"><AlertDialogAction>确认删除</AlertDialogAction></AlertDialogContent>
      </AlertDialog>,
    );

    await user.click(screen.getByRole("button", { name: "删除" }));
    const overlay = document.querySelector(".sueno-alert-dialog-overlay");
    expect(overlay).toBeInTheDocument();
    fireEvent.click(overlay!);
    expect(screen.getByRole("alertdialog", { name: "删除确认" })).toBeInTheDocument();
  });

  it("supports immediate tooltip feedback without leaving a live node after blur", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip delayDuration={0}>
        <TooltipTrigger><button type="button">帮助</button></TooltipTrigger>
        <TooltipContent>说明</TooltipContent>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "帮助" });
    await user.hover(trigger);
    expect(screen.getByRole("tooltip", { name: "说明" })).toBeInTheDocument();
    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip", { name: "说明" })).not.toBeInTheDocument();
  });
});
