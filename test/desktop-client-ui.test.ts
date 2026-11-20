import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

describe('DSH Desktop client slot occupants', () => {
  it('registers one occupant per brand seat and keeps the official name mark-free', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )
    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    const appended: Array<{ textContent?: string }> = []
    const removeStyle = vi.fn()
    let disposeStyle: (() => void) | undefined
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '', remove: removeStyle })),
      head: { appendChild: (node: { textContent?: string }) => appended.push(node) }
    }
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        dshDesktop: { getRepairDraft: vi.fn(), openRepairAgent: vi.fn() },
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })

    expect(definition).toBeDefined()
    const createElement = (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): { type: unknown; props: Record<string, unknown> } => ({
      type,
      props: { ...props, children }
    })
    const BrandWordmark = vi.fn()
    const FishLogo = vi.fn()
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()]
        }
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { BrandWordmark, FishLogo }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const slots = {
      inject: (_name: string, callback: () => unknown): unknown => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) void _entry
        }
        return result
      },
      register: (
        config: Registration['config'],
        component: Registration['component']
      ): (() => void) => {
        registrations.push({ config, component })
        return () => undefined
      }
    }
    plugin.apply({ slots, locale: { register: () => () => undefined, bind: () => (key: string) => key }, effect: (setup: () => (() => void) | undefined) => { disposeStyle = setup() } })

    expect(plugin.inject).toEqual(['locale', 'slots', 'remote.session', 'sessions', 'uiWorkspace'])
    // 新契约：除品牌与既有设置入口外，再占用一个通用设置项承载「性能模式」开关。
    // 旧契约只有品牌座位和企业版入口（10 项），新增项排在 sidebar.settings.action 之后。
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'conversation.input.dock',
      'sidebar.settings.action',
      'settings.general.item',
      'settings.sidebar.footer',
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'sidebar.right.tab.document.unpreviewable',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item'
    ])
    const perfSetting = registrations.find(({ config }) => config.id === 'desktop-perf-mode')
    expect(perfSetting?.config.name).toBe('settings.general.item')
    const enterprise = registrations.find(({ config }) => config.name === 'settings.sidebar.footer')
    expect(enterprise?.config.id).toBe('desktop-enterprise-entry')
    const entry = enterprise!.component({ t: () => '了解企业版' }) as { type: unknown; props: Record<string, unknown> }
    expect(entry.type).toBe('a')
    expect(entry.props.href).toBe('https://dshdesktop.com/zh/enterprise/')
    expect(entry.props.target).toBe('_blank')
    expect(entry.props.rel).toBe('noopener noreferrer')
    expect(entry.props.children).toContain('了解企业版')
    // Desktop toolbar styles have an owned lifetime; branding stays in currentColor.
    expect(appended).toHaveLength(1)
    expect(appended[0]?.textContent).toContain("[data-dsh-preset-search]")
    expect(appended[0]?.textContent).toContain("[data-dsh-market-nav-icon] span[class*=\"navIcon\"]")
    expect(appended[0]?.textContent).toContain("[data-dsh-better-sidebar-settings-nav] span[class*=\"navIcon\"]")
    disposeStyle?.()
    expect(removeStyle).toHaveBeenCalledOnce()

    const sidebarName = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component({}) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarName.type).toBe(BrandWordmark)
    expect(sidebarName.props.includeMark).toBe(false)

    const sidebarMark = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.mark'
    )!.component({ size: 24 }) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarMark.type).toBe('svg')
    expect(sidebarMark.props.height).toBe(17)
    const [markPath] = sidebarMark.props.children as Array<{ type: unknown; props: Record<string, unknown> }>
    if (!markPath) throw new Error('Expected the sidebar brand SVG path')
    expect(markPath.type).toBe('path')
    expect(markPath.props.fill).toBe('currentColor')

    const heroMark = registrations.find(
      ({ config }) => config.name === 'conversation.hero.brand.mark'
    )!.component({ size: 48 }) as { type: unknown; props: Record<string, unknown> }
    expect(heroMark.type).toBe(FishLogo)
    expect(heroMark.props.size).toBe(48)
  })

  // 性能模式会替换全局 requestAnimationFrame；这条用例保证它只在用户开启时生效，
  // 并且在插件销毁后把样式与全局函数都还原，避免热重载或退出后留下副作用。
  it('applies the opt-in performance mode and restores every global on dispose', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )

    const boot = (storedPreference: string | null) => {
      let definition:
        | { factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } }
        | undefined
      const styles = new Map<string, { id: string; textContent: string }>()
      const document = {
        getElementById: (id: string) => styles.get(id) ?? null,
        createElement: () => {
          const node = {
            id: '',
            textContent: '',
            remove: () => {
              styles.delete(node.id)
            }
          }
          return node
        },
        head: {
          appendChild: (node: { id: string; textContent: string }) => {
            styles.set(node.id, node)
            return node
          }
        }
      }
      const originalFrame = vi.fn()
      const originalCancel = vi.fn()
      const window = {
        __ModuleLoader__: {
          load: (value: unknown) => {
            definition = value as typeof definition
          }
        },
        dshDesktop: { getRepairDraft: vi.fn(), openRepairAgent: vi.fn() },
        localStorage: {
          getItem: (key: string) => (key === 'dsh-desktop.perf-mode' ? storedPreference : null),
          setItem: vi.fn(),
          removeItem: vi.fn()
        },
        requestAnimationFrame: originalFrame,
        cancelAnimationFrame: originalCancel,
        setTimeout: vi.fn(() => 1),
        clearTimeout: vi.fn()
      }
      vm.runInNewContext(source, {
        document,
        navigator: { language: 'en-US' },
        performance: { now: () => 0 },
        console,
        window
      })
      if (!definition) throw new Error('Expected the client plugin definition')
      const plugin = definition.factory((id) => {
        if (id === 'react') {
          return {
            createElement: () => null,
            useEffect: () => undefined,
            useLayoutEffect: () => undefined,
            useSyncExternalStore: () => false,
            useState: (initial: unknown) => [initial, vi.fn()]
          }
        }
        if (id === '@deepseek-ai/dsh-client-ui-primitives') {
          return {
            BrandWordmark: 'brand',
            FishLogo: 'fish',
            MenuItemButton: 'item',
            Switch: 'switch',
            Tooltip: 'tooltip'
          }
        }
        throw new Error(`Unexpected client dependency: ${id}`)
      })
      const disposers: Array<() => void> = []
      plugin.apply({
        effect: (setup: () => (() => void) | undefined) => {
          const dispose = setup()
          if (dispose) disposers.push(dispose)
        },
        locale: { register: () => () => undefined, bind: () => (key: string) => key },
        slots: {
          inject: (_name: string, callback: () => unknown) => callback(),
          register: () => () => undefined
        }
      })
      return { styles, window, originalFrame, originalCancel, disposers }
    }

    const enabled = boot('1')
    expect(enabled.styles.get('dsh-desktop-perf-mode-style')?.textContent).toContain(
      'animation-iteration-count:1'
    )
    expect(enabled.window.requestAnimationFrame).not.toBe(enabled.originalFrame)
    for (const dispose of enabled.disposers.reverse()) dispose()
    expect(enabled.styles.has('dsh-desktop-perf-mode-style')).toBe(false)
    expect(enabled.window.requestAnimationFrame).toBe(enabled.originalFrame)
    expect(enabled.window.cancelAnimationFrame).toBe(enabled.originalCancel)

    const disabled = boot(null)
    expect(disabled.styles.has('dsh-desktop-perf-mode-style')).toBe(false)
    expect(disabled.window.requestAnimationFrame).toBe(disabled.originalFrame)
    expect(disabled.window.cancelAnimationFrame).toBe(disabled.originalCancel)
  })
})
