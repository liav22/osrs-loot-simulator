import { describe, expect, it } from 'vitest'
import {
  evaluateExpr,
  expandTransclusions,
  transclusionBody,
} from '../src/parse/expand-transclusions.js'
import { extractDropLines, findRowlessTemplateBlocks } from '../src/parse/wikitext-drops.js'
import { extractRdtAccessLines } from '../src/parse/rdt-access.js'

/**
 * The transclusion expander. Every fixture here is synthetic and mimics only
 * the SHAPE of the real templates — wiki-derived drop rows never leave
 * `data/`, per the Phase 2 licensing decision.
 *
 * The real-corpus assertions live in `transclusion-coverage.test.ts`, which
 * checks the expansion against the wiki's own published rarities.
 */

const defs = (entries: Record<string, string>): ReadonlyMap<string, string> =>
  new Map(Object.entries(entries))

describe('evaluateExpr', () => {
  it('evaluates arithmetic with the usual precedence', () => {
    expect(evaluateExpr('1 + 2 * 3')).toBe(7)
    expect(evaluateExpr('(1 + 2) * 3')).toBe(9)
    expect(evaluateExpr('-4 + 1')).toBe(-3)
  })

  it('divides left-associatively, which is what the access-rate bases rely on', () => {
    // {{#vardefine:thsdtbase|{{#expr:3/150/250}}}} — a "3/150" access rate
    // passed as one positional argument, divided again by the sub-table's own
    // denominator. Right-associative division would give 5, not 0.00008.
    expect(evaluateExpr('3/150/250')).toBeCloseTo(0.00008, 12)
  })

  it("implements `round` as MediaWiki's binary operator, half away from zero", () => {
    expect(evaluateExpr('416.6666 round 1')).toBe(416.7)
    expect(evaluateExpr('2.5 round 0')).toBe(3)
    expect(evaluateExpr('-2.5 round 0')).toBe(-3)
  })

  it('reproduces a published rarity denominator end to end', () => {
    // Ranarr seed's 30/250 share of a 3/150 access rate is the wiki's 1/416.7.
    expect(evaluateExpr('1/(30*(3/150/250)) round 1')).toBe(416.7)
  })

  it('compares and exponentiates, which a #switch selecting a rate depends on', () => {
    // Regression, and the sharpest lesson of this work.
    // `WildernessSlayerDropTable` picks its key denominator with
    // `{{#switch: 1 | {{#expr: {{{combat}}} < 81 }} = ... | 1 = 50 }}`. An
    // evaluator without `<` does not fail loudly here: the switch falls
    // through to its literal `| 1 = 50` case and publishes a plausible, wrong
    // 1/50 — which shipped on five sources whose real rates are 1/55 to 1/76,
    // and which `drops_covered` cannot see, because coverage is by item NAME.
    expect(evaluateExpr('470 < 81')).toBe(0)
    expect(evaluateExpr('70 < 81')).toBe(1)
    expect(evaluateExpr('1 = 1')).toBe(1)
    expect(evaluateExpr('1 != 1')).toBe(0)
    expect(evaluateExpr('(80 - 70) ^ 2')).toBe(100)
    // The real branch, for a combat level below 81.
    expect(evaluateExpr('100 + floor(((3 / 10) * (80 - 70) ^ 2))')).toBe(130)
    // And the one every wilderness boss above 350 takes.
    expect(evaluateExpr('floor(99 - (470 - 81) * (49 / (350 - 81)))')).toBe(28)
  })

  it('binds `round` tighter than a comparison, as ParserFunctions does', () => {
    expect(evaluateExpr('1 < 2.4 round 0')).toBe(1)
  })

  it('throws on anything it does not recognise rather than returning a number', () => {
    expect(() => evaluateExpr('1 + {{GEP|Abyssal whip}}')).toThrow(/unsupported token/)
    expect(() => evaluateExpr('1/0')).toThrow(/division by zero/)
  })
})

describe('transclusionBody', () => {
  it('drops <noinclude>, unwraps <includeonly>, and strips comments', () => {
    expect(transclusionBody('<includeonly>rows</includeonly><noinclude>{{/doc}}</noinclude>')).toBe(
      'rows'
    )
    expect(transclusionBody('a<!-- gone -->b')).toBe('ab')
  })

  it('lets <onlyinclude> win outright', () => {
    expect(transclusionBody('before<onlyinclude>rows</onlyinclude>after')).toBe('rows')
  })
})

describe('expandTransclusions', () => {
  it('turns a transcluded sub-table into the DropsLine rows the extractor reads', () => {
    const wikitext = [
      '\n==Drops==\n',
      '\n===Widgets===\n',
      '{{WidgetDropLines|1/70}}\n',
    ].join('')
    const definitions = defs({
      widgetdroplines:
        '<includeonly>{{#vardefine:base|{{#expr:{{{1}}}/70}}}}' +
        '{{DropsLine|name=Red widget|quantity=1|rarity=1/{{#expr:1/(10*{{#var:base}}) round 1}}}}\n' +
        '{{DropsLine|name=Blue widget|quantity=1|rarity=1/{{#expr:1/(60*{{#var:base}}) round 1}}}}' +
        '</includeonly>',
    })

    expect(extractDropLines(wikitext)).toHaveLength(0)

    const result = expandTransclusions(wikitext, definitions)
    expect(result.expanded).toEqual(['widgetdroplines'])
    expect(result.unexpandable).toEqual([])

    const lines = extractDropLines(result.wikitext)
    expect(lines.map((l) => [l.heading, l.name, l.rarity])).toEqual([
      // base = (1/70)/70 = 1/4900, so a 10/70 share is 1/490.
      ['Widgets', 'Red widget', '1/490'],
      ['Widgets', 'Blue widget', '1/81.7'],
    ])
  })

  it('keeps the DropsLine CALL intact, expanding only its arguments', () => {
    // This is the whole reason expansion is local rather than
    // `action=expandtemplates`: the API would return the rendered wikitable
    // row and throw away the parameter names the parser reads.
    const result = expandTransclusions('{{DropsLine|name=X|rarity=1/{{#expr:2*4}}}}', defs({}))
    expect(result.wikitext).toBe('{{DropsLine|name=X|rarity=1/8}}')
  })

  it('substitutes named, positional and defaulted parameters', () => {
    const definitions = defs({
      t: '<includeonly>{{DropsLine|name={{{1}}}|quantity={{{multiplier|1}}}|rarity={{{rare|1/2}}}}}</includeonly>',
    })
    // Rows emitted from inside a transclusion also carry the parser-internal
    // provenance parameters, which is how `build-tables.ts` learns that a
    // block is one sub-table and at what declared access rate.
    expect(expandTransclusions('{{t|Thing}}', definitions).wikitext).toBe(
      '{{DropsLine|name=Thing|quantity=1|rarity=1/2|__expandedfrom=t|__accessrate=Thing}}'
    )
    expect(expandTransclusions('{{t|Thing|multiplier=2|rare=1/9}}', definitions).wikitext).toBe(
      '{{DropsLine|name=Thing|quantity=2|rarity=1/9|__expandedfrom=t|__accessrate=Thing}}'
    )
  })

  it('resolves #if, #ifeq, #switch and #varexists', () => {
    const definitions = defs({
      t:
        '<includeonly>{{#if:{{{a|}}}|yes|no}}/{{#ifeq:{{{a|}}}|x|eq|ne}}/' +
        '{{#switch:{{{a|}}}|x=X|#default=D}}/{{#varexists:nope|set|unset}}</includeonly>',
    })
    expect(expandTransclusions('{{t}}', definitions).wikitext).toBe('no/ne/D/unset')
    expect(expandTransclusions('{{t|a=x}}', definitions).wikitext).toBe('yes/eq/X/unset')
  })

  it('carries #vardefine state across templates, as the page-scoped wiki extension does', () => {
    const definitions = defs({
      setter: '<includeonly>{{#vardefine:shared|7}}</includeonly>',
      getter: '<includeonly>{{#var:shared}}</includeonly>',
    })
    expect(expandTransclusions('{{setter}}{{getter}}', definitions).wikitext).toBe('7')
  })

  it('renames DropsLineSkill to DropsLine, since the row shape is identical', () => {
    // UncommonSeedDropLines builds its own template name as
    // `DropsLine{{#var:skill}}`, which resolves to DropsLineSkill when the
    // page passed skill=.
    const result = expandTransclusions('{{DropsLineSkill|name=X|rarity=1/2|skill=Farming}}', defs({}))
    expect(result.wikitext).toBe('{{DropsLine|name=X|rarity=1/2|skill=Farming}}')
    expect(extractDropLines('\n==Drops==\n' + result.wikitext)).toHaveLength(1)
  })

  it('leaves a template with no definition on disk exactly as it found it', () => {
    const wikitext = '{{SomethingUnknown|1/50}} {{CiteTwitter|author=Mod Ash}}'
    expect(expandTransclusions(wikitext, defs({})).wikitext).toBe(wikitext)
  })

  it('reports a Lua-backed template instead of silently yielding nothing', () => {
    const definitions = defs({ luathing: '<includeonly>{{#invoke:LuaThing|main}}</includeonly>' })
    const result = expandTransclusions('{{LuaThing|1/50}}', definitions)
    expect(result.wikitext).toBe('{{LuaThing|1/50}}')
    expect(result.expanded).toEqual([])
    expect(result.unexpandable).toEqual([
      { template: 'luathing', reason: expect.stringContaining('Lua module') },
    ])
  })

  it('does NOT inline the shared-table access templates, which rdt-access.ts owns', () => {
    // Inlining these would both undo Phase 3's shared `data/tables/*.json`
    // records and break `rdt-access.ts`, which reads the same wikitext and
    // looks for these calls by name.
    const wikitext = '\n==Drops==\n\n===Rare drop table===\n{{RareDropTable|1/128|2/128}}\n'
    const definitions = defs({
      raredroptable: '<includeonly>{{DropsTableHead}}{{#invoke:RareDropLines|main}}</includeonly>',
    })
    const result = expandTransclusions(wikitext, definitions)
    expect(result.wikitext).toContain('{{RareDropTable|1/128|2/128}}')
    expect(result.expanded).toEqual([])
    expect(extractRdtAccessLines(result.wikitext).lines).toHaveLength(2)
  })

  it('does not report a page-level #expr it cannot evaluate', () => {
    // The page's own average-kill-value arithmetic over live GE prices. Not a
    // drop row, not this module's business, and `ev_matches` owns it.
    const result = expandTransclusions('{{#expr:26 * {{GEP|Abyssal whip}}}}', defs({}))
    expect(result.unexpandable).toEqual([])
  })

  it('does not report a branch the calling page never supplied an argument for', () => {
    // `WildernessSlayerDropTable` computes a `combatmax` bound for pages that
    // state a combat-level RANGE. For the eight that do not, MediaWiki itself
    // renders an expression error there and never reads the result, so
    // reporting it would block those sources on the wiki's own dead code.
    const definitions = defs({
      t: '<includeonly>{{#vardefine:unused|{{#expr:{{{combatmax}}} < 81}}}}{{DropsLine|name=X|rarity=1/50}}</includeonly>',
    })
    const result = expandTransclusions('{{t|combat=470}}', definitions)
    expect(result.unexpandable).toEqual([])
    expect(result.wikitext).toContain('{{DropsLine|name=X|rarity=1/50')
  })

  it('reports an #expr it cannot evaluate INSIDE an expansion, where a rate depends on it', () => {
    const definitions = defs({
      t: '<includeonly>{{DropsLine|name=X|rarity=1/{{#expr:mystery}}}}</includeonly>',
    })
    const result = expandTransclusions('{{t}}', definitions)
    expect(result.unexpandable).toHaveLength(1)
    expect(result.unexpandable[0]?.reason).toMatch(/unsupported token/)
  })

  it('terminates on a self-referential template rather than hanging', () => {
    const result = expandTransclusions('{{loop}}', defs({ loop: '<includeonly>{{loop}}</includeonly>' }))
    expect(result.unexpandable[0]?.reason).toMatch(/exceeded/)
  })

  it('leaves unbalanced braces alone instead of consuming the rest of the page', () => {
    expect(expandTransclusions('{{unclosed|a', defs({})).wikitext).toBe('{{unclosed|a')
  })
})

describe('findRowlessTemplateBlocks', () => {
  it('names the sub-section whose body is a template and produced no rows', () => {
    const wikitext = '\n==Drops==\n\n===Sigils===\n{{Uniques/Some Boss}}\n'
    expect(findRowlessTemplateBlocks(wikitext)).toEqual([
      { section: '', heading: 'Sigils', templates: ['Uniques/Some Boss'] },
    ])
  })

  it('says nothing once expansion has produced the rows', () => {
    const definitions = defs({
      'uniques/some boss': '<includeonly>{{DropsLine|name=Sigil|rarity=1/1365}}</includeonly>',
    })
    const wikitext = '\n==Drops==\n\n===Sigils===\n{{Uniques/Some Boss}}\n'
    const expanded = expandTransclusions(wikitext, definitions).wikitext
    expect(findRowlessTemplateBlocks(expanded)).toEqual([])
  })

  it('ignores the wikitable scaffolding and the shared-table access calls', () => {
    // DropsTableHead/Bottom are what a transcluded sub-table leaves behind,
    // and rdt-access.ts reports its own unresolved cases (GWDRDT included).
    const wikitext = '\n==Drops==\n\n===Rare drop table===\n{{DropsTableHead}}{{GWDRDT}}{{DropsTableBottom}}\n'
    expect(findRowlessTemplateBlocks(wikitext)).toEqual([])
  })

  it('ignores a prose-only sub-section, which has no template to lose', () => {
    const wikitext = '\n==Drops==\n\n===Notes===\nJust prose about the fight.\n'
    expect(findRowlessTemplateBlocks(wikitext)).toEqual([])
  })
})
