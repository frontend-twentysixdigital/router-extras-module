import fs from 'fs-extra'
import matter from 'gray-matter'

import { NUXT_VALID_EXTRAS, VALID_EXTRAS } from './constants'

/**
 * cache extracted extras
 */
const parsedRoutes = {}

let localRoutes = []

export async function extendRoutes (routes, options) {
  localRoutes = localRoutes.concat(routes)

  let additionalRoutes = []

  for (const route of routes) {
    const extras = await extractExtrasFromRoute(route)

    Object.assign(route, pick(extras, NUXT_VALID_EXTRAS))
    const { alias = [] } = extras
    const simpleAlias = alias.filter(alias => typeof alias === 'string')
    const objectAlias = alias.filter(alias => typeof alias === 'object')

    // It's important to handle object aliases first
    // Before adding alias to root route
    if (objectAlias.length > 0) {

      const objectAliasNested = objectAlias.filter(objectAlias => objectAlias.parent);
      objectAliasNested.forEach(objectAliasNested => {
        const parentRoute = routes.find(route => route.path === objectAliasNested.parent);
        if (!parentRoute) {
          return;
        }
        if (!parentRoute.children) {
          parentRoute.children = [];
        }
        parentRoute.children.push({
          name: `${objectAliasNested.parent}/${objectAliasNested.path}`,
          path: objectAliasNested.path,
          component: route.component
        });
      });

      const objectAliasTop = objectAlias.filter(objectAlias => !objectAlias.parent);
      additionalRoutes = [].concat(additionalRoutes, mapObjectAliases(route, objectAliasTop))
    }

    if (simpleAlias.length > 0) {
      if (options.routerNativeAlias) {
        Object.assign(route, { alias: simpleAlias })
      } else {
        additionalRoutes = [].concat(additionalRoutes, mapSimpleAliases(route, simpleAlias))
      }
    }

    // process child routes
    if (Array.isArray(route.children)) {
      await extendRoutes(route.children, options)
    }
  }
  additionalRoutes.forEach(route => routes.push(route))
}

function mapSimpleAliases (route, aliases) {
  return aliases.map((alias, index) => Object.assign({}, route, {
    path: alias,
    name: `${route.name}${alias}`
  }))
}

function mapObjectAliases (route, aliases) {
  return aliases.map((alias, index) => Object.assign({}, route, {
    ...pick(alias, NUXT_VALID_EXTRAS),
    path: alias.path,
    name: `${route.name}${alias.path}`
  }))
}

export async function invalidateRoute (file) {
  const routes = localRoutes.filter(route => route.component === file)
  if (routes.length) {
    const extras = await extractExtrasFromRoute(routes[0], false)

    if (extras._needUpdate) {
      return true
    }
  }

  return false
}

async function extractExtrasFromRoute (route, useCache = true) {
  const previousExtras = parsedRoutes[route.component]
  if (previousExtras && useCache) {
    return previousExtras
  }

  let extras = {
    _raw: '',
    _needUpdate: false
  }
  const routerBlock = await extractRouterBlockFromFile(route.component)

  if (routerBlock) {
    const parsed = matter([
      '---' + routerBlock.lang,
      routerBlock.content,
      '---'
    ].join('\n'))

    extras = validateExtras(parsed.data)
    // Keep raw value to detect changes
    extras._raw = routerBlock.content
    // Wheter route need to update or not
    extras._needUpdate = !previousExtras || previousExtras._raw !== routerBlock.content
  }
  // Update cache
  parsedRoutes[route.component] = extras

  return extras
}

export function pick (object, fields) {
  return fields.reduce((map, key) => {
    if (object.hasOwnProperty(key)) {
      map[key] = object[key]
    }
    return map
  }, {})
}

export async function extractRouterBlockFromFile (path) {
  // Read component content
  const content = await fs.readFile(path, 'utf8')

  // Extract script
  const routerContentMatch = content.match(/<router(\s[^>\s]*)*>([\S\s.]*?)<\/router>/)
  if (routerContentMatch) {
    const [, attrs, content] = routerContentMatch
    const lang = extractLanguage(content, attrs)
    return {
      content,
      lang,
      attrs
    }
  }
  return null
}

export function validateExtras (extras) {
  // Validate path
  if (extras.path && typeof extras.path !== 'string') {
    extras.path = String(extras.path)
  }

  // Validate alias
  if (extras.alias && !Array.isArray(extras.alias)) {
    extras.alias = [String(extras.alias)]
  }

  return pick(extras, VALID_EXTRAS)
}

function extractLanguage (content, attrs) {
  if (attrs) {
    const attributeLang = attrs.match(/\slang="(.+?)"/)
    if (attributeLang) {
      return attributeLang[1]
    }
  }
  return content.trim()[0] === '{' ? 'js' : 'yaml'
}
