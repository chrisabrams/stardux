'use strict'

/**
 * Module dependencies.
 *
 * @private
 */

import { combineReducers, createStore } from 'redux'
import { Parser, Template } from 'starplate'
import esprima from 'esprima'
import extend from 'extend'
import domify from 'domify'

/**
 * Container symbols.
 *
 * @private
 */

const $domElement = Symbol('Element')
const $middleware = Symbol('middleware')
const $children = Symbol('children')
const $pipes = Symbol('pipes')
const $model = Symbol('model')
const $store = Symbol('store')
const $uid = Symbol('uid')

/**
 * Private stardux data attached to
 * traversed DOM elements.
 *
 * @private
 * @const
 * @type {String}
 */

const STARDUX_PRIVATE_ATTR = '__starduxData'

/**
 * Reducer action type symbols.
 *
 * @private
 * @const
 * @type {Symbol)
 */

const $UPDATE_ACTION = Symbol('UPDATE')

/**
 * Known container map by ID
 *
 * @private
 * @type {Map}
 */

const CONTAINERS = new Map()

/**
 * Clones an object.
 *
 * @private
 * @param {Object} object
 * @return {Object}
 */

function clone (object) {
  return extend(true, {}, object)
}

/**
 * Detects if input is "like" an array.
 *
 * @private
 * @param {Mixed} a
 * @return {Boolean}
 */

function isArrayLike (a) {
  if ('object' != typeof a)
    return false
  else if (null == a)
    return false
  else
    return Boolean( Array.isArray(a)
                    || null != a.length
                    || a[0] )
}

/**
 * Make stardux data object on a
 * node if not already there.
 *
 * @private
 * @param {Object} node
 * @param {Object} [data = {}]
 * @return {Object}
 */

function mkdux (node, data = {}) {
  if (node instanceof Container)
    node = node.domElement
  node[STARDUX_PRIVATE_ATTR] = ( node[STARDUX_PRIVATE_ATTR] || data )
  return node[STARDUX_PRIVATE_ATTR]
}

/**
 * Remove stardux data object.
 *
 * @private
 * @param {Object} node
 */

function rmdux (node) {
  if (null == node) return
  if (node instanceof Container)
    node = node.domElement
  delete node[STARDUX_PRIVATE_ATTR]
}

/**
 * Returns an array of known tokens
 * in a javascript string.
 *
 * @private
 * @param {String} string
 * @return {Array}
 */

function getTokens (string) {
  let tokens = null
  try { tokens = esprima.tokenize('`'+ string +'`') }
  catch (e) { tokens = [] }
  return tokens
}

/**
 * Returns an object of identifiers with
 * empty string or NO-OP function
 * values.
 *
 * @private
 * @param {Array} tokens
 * @return {Object}
 */

function getIdentifiersFromTokens (tokens) {
  const identifiers = {}

  /**
   * Predicate to determine if token is an identifier.
   *
   * @private
   * @param {Object} token
   * @return {Boolean}
   */

  const isIdentifier = token => 'Identifier' == token.type

  /**
   * Mark token as a function identifier.
   *
   * @private
   * @param {Object} token
   * @param {Number} index
   * @return {Object} token
   */

  const markFunction = (token, index) => {
    const next = tokens[index + 1] || null
    token.isFunction = ( 'Identifier' == token.type
                        && 'object' == typeof next && next
                        && 'Punctuator' == next.type
                        && '(' == next.value
                          ? true : false )
    return token
  }

  /**
   * Mark token as a object identifier.
   *
   * @private
   * @param {Object} token
   * @param {Number} index
   * @return {Object} token
   */

  const markObject = (token, index) => {
    const next = tokens[index + 1] || null
    token.isObject = ( 'Identifier' == token.type
                      && 'object' == typeof next && next
                      && 'Punctuator' == next.type
                      && '.' == next.value
                        ? true : false )
    return token
  }

  /**
   * Assign token value to identifierss map.
   *
   * @private
   * @param {Object} map
   * @param {Object} token
   * @return {Object} map
   */

  const assign = (map, token) => {
    const value = token.value
    if (token.isFunction)
      map[value] = _ => ''
    else if (token.isObject)
      map[value] = {}
    else
      map[value] = ''
    return map
  }

  // resolve identifierss and return map
  return ( tokens
          .map((t, i) => markFunction(t, i))
          .map((t, i) => markObject(t, i))
          .filter(t => isIdentifier(t))
          .reduce((map, t) => assign(map, t), identifiers) )
}

/**
 * Ensures a DOM string from a given input.
 *
 * @private
 * @param {String} html
 * @return {String}
 */

function ensureDOMString (html = '') {
  html = 'string' == typeof html ? html : String(html || '')
  return html.trim()
}

/**
 * Ensure DOM element.
 *
 * @private
 * @param {Mixed} input
 * @return {Element}
 */

function ensureDOMElement (input) {
  let domElement = null
  let tmp = null
  if (input instanceof Element) {
    return input
  } else if ('string' == typeof input) {
    tmp = document.createElement('div')
    tmp.innerHTML = input
    domElement = tmp.innerHTML.length ? tmp.children[0] : new Template(input)
  } else {
    domElement = document.createElement('div')
  }
  return domElement
}

/**
 * Returns a template tring from a given
 * DOM Element. If the DOM Element given is a
 * string then it is simply returned.
 *
 * @public
 * @param {Element|String} domElement
 * @return {String}
 */

function getTemplateFromDomElement (domElement) {
  let data = {}
  let src = null

  if (domElement && domElement[STARDUX_PRIVATE_ATTR])
    data = mkdux(domElement)

  if ('string' == typeof domElement)
    src = domElement
  else if (data.src)
    src = data.src
  else if (domElement.children && 0 == domElement.children.length)
    src = ensureDOMString(domElement.textContent)
  else if (domElement.firstChild instanceof Text)
    src = ensureDOMString(domElement.innerHTML)
  else if (domElement instanceof Text)
    src = ensureDOMString(domElement.textContent)
  else if (domElement)
    src = domElement.innerHTML || domElement.textContent

  return src
}

/**
 * Ensures container state identifiers (tokens) derived from
 * the DOM element source are defined on the state if not
 * already. This is useful to prevent reference errors from
 * being thrown when ES6 templates are evaulated in starplate's
 * VM.
 *
 * @private
 * @param {Container} container
 * @return {Object} identifiers
 */

function ensureContainerStateIdentifiers (container) {
  const domElement = container[$domElement]
  const template = getTemplateFromDomElement(domElement)
  const tokens = getTokens(template)
  const identifiers = getIdentifiersFromTokens(tokens)
  const update = {}
  const state = container.state
  if (identifiers) {
    for (let key in identifiers) {
      if (undefined === state[key])
        update[key] = identifiers[key]
    }

    container.define(update)
  }
  return identifiers || null
}

/**
 * Creates a root reducer for a Container
 * instance.
 *
 * @private
 * @param {Container} container
 * @return {Function}
 */

function createRootReducer (container) {
  return (state = {}, action = {data: {}}) => {
    const identifiers = ensureContainerStateIdentifiers(container)
    const domElement = container[$domElement]
    const template = getTemplateFromDomElement(domElement)
    const middleware = container[$middleware].entries()
    const isBody = domElement == document.body

    action.data = action.data || {}

    void function next () {
      const step = middleware.next()
      const done = step.done
      const reducer = step.value ? step.value[0] : null
      if (done) return
      else if (null == reducer) next()
      else if (false === reducer(state, action)) return
      else next()
    }()

    switch (action.type) {
      case $UPDATE_ACTION:
        container.define(action.data)
        if (!isBody && identifiers) {
          const parser = new Parser()
          const partial = new Template(template)
          const src = partial.render(container.state, container)
          const patch = parser.createPatch(src)
          patch(domElement)
      }
      break
    }

    return extend(true, container.state, state, action.data)
  }
}

/**
 * Creates a pipe reducer for a Container
 * instance.
 *
 * @private
 * @param {Container} container
 * @return {Function}
 */

function createPipeReducer (container) {
  return (_, action = {data: {}}) => {
    const state = container.state
    const pipes = container[$pipes].entries()
    reduce()
    return container.state
    function reduce () {
      const step = pipes.next()
      const done = step.done
      const pipe = step.value ? step.value[1] : null
      if (done) return
      else if (false === pipe(state, action)) return
      else return reduce()
    }
  }
}

/**
 * UPDATE event type.
 *
 * @public
 * @const
 * @type {Symbol}
 */

export const UPDATE = $UPDATE_ACTION

/**
 * Create a new Container instance.
 *
 * @public
 * @param {Element} domElement
 * @param {Object} [initialState = null]
 * @param {Function} [...reducers]
 * @return {Container}
 */

export default createContainer
export function createContainer (domElement, initialState = null, ...reducers) {
  const container = ( fetchContainer(domElement)
                   || new Container(domElement, ...reducers) )
  return container.update(initialState)
}

/**
 * Claims a DOM element as a container and
 * returns container.
 *
 * @public
 * @param {Element} domElement
 * @return {Container}
 */

export function makeContainer (domElement) {
  let container = null
  if (false == (domElement instanceof Element))
    throw new TypeError("makeContainer() expects a DOM element.")
  container = fetchContainer(domElement) || new Container(domElement)
  return container
}

/**
 * Create or restore a Container instance
 * from a JSON object.
 *
 * @public
 * @param {Object} json
 * @param {Object} [initialState = null]
 * @param {Function} [...reducers]
 * @return {Container}
 */

export function restoreContainerFromJSON (json, initialState = null, ...reducers) {
  const id = json.id
  const src = json.src
  let data = null
  let children = []
  let container = fetchContainer(id)
  let domElement = null

  if (null == container)
    container = new Container(null, ...reducers)

  container[$uid] = id
  domElement = container.domElement
  data = mkdux(domElement)

  saveContainer(container)

  if (src != data.src)
    data.src = src

  if (initialState)
    container.update(initialState)

  for (let child of json.children)
    children.push(restoreContainerFromJSON(child, initialState))

  realignContainerTree(container, true, true)

  for (let child of children)
    if (false == container.contains(child))
      container.appendChild(child, false)

  return container.update()
}

/**
 * Compose a container from containers or DOM elements.
 * If a Container or Element is given as first argument then
 * it is treated as the root and all subsequent arguments are
 * treated as direct descendants of the root. If the second
 * argument is an array or an "array like" object then it is
 * treated as direct descendants of the root and all subsequent
 * arguments are ignored. If an array or "array like" object is
 * passed as the first argument a new root container is created
 * and the first argument is treated as direct descendants of
 * the newly created root container. The root container, newly
 * created or restored is returned.
 *
 * @public
 * @param {?(Element|Container)} root
 * @param {?(Element|Container|String)} ...containers
 * @return {Container}
 */

export function composeContainers (root, ...containers) {
  let composed = null
  let updateChildren = false
  const children = []

  // array of containers
  if (isArrayLike(root)) {
    containers = [ ...root ].map(createContainer)
    root = null
  } else {
    // derive containers from arguments
    if (isArrayLike(containers[0]))
      containers = [ ...containers[0] ]
    containers = [ ...containers ].map(createContainer)
  }

  composed = createContainer(root || undefined)

  // create composite
  let composite = composed
  for (let child of containers)
    composite = composite.pipe(child)

  // realign root tree
  realignContainerTree(composed, true)

  // allow consumer to unwind composition
  composed.decompose = _ => {
    let composite = composed
    for (let child of containers)
      composite = composite.unpipe(child)
    // remove this function
    delete composed.decompose
    return composed
  }

  return composed
}

/**
 * Returns immutable private stardux data for a given
 * input. Input can be a container, an Element,
 * or a string representing a container ID. If data is
 * not found then null is returned.
 *
 * @public
 * @param {Container|Element|String} arg
 * @return {Object}
 */

export function getContainerData (arg) {
  let data = null
  let container = null
  let domElement = null

  if (arg instanceof Container) {
    domElement = arg.domElement
  } else if (arg instanceof Element) {
    domElement = arg
  } else if ('string' == typeof arg) {
    container = fetchContainer(arg)
    domElement = container.domElement
  } else {
    throw new TypeError( "Unexpected input for getContainerData. "
                       + "Expecting an instance of a Container or Element, "
                       + "or a string." )
  }

  if (domElement)
    data = domElement[STARDUX_PRIVATE_ATTR]
  return data ? Object.freeze(data) : null
}

/**
 * Restores orphaned children containers
 * still attached to a container.
 *
 * @public
 * @param {Container|Element} container
 * @param {Boolean} [recursive = false]
 */

export function restoreOrphanedTree (container, recursive = false) {
  if (container instanceof Element)
    container = fetchContainer(container)

  if (null == container)
    return

  const domElement = container.domElement
  const children = container[$children]

  for (let child of [ ...children ]) {
    const childDomElement = child.domElement

    if (false == domElement.contains(childDomElement))
      domElement.appendChild(childDomElement)

    if (recursive)
      restoreOrphanedTree(child, true)
  }
}

/**
 * Realign container DOM tree.
 *
 * @public
 * @param {Container} container
 * @param {Boolean} [recursive = false]
 * @param {Boolean} [forceOrphanRestoration = false]
 */

export function realignContainerTree (container,
                                      recursive = false,
                                      forceOrphanRestoration = false) {
  const domElement = container.domElement
  const children = container[$children]

  if (null == domElement.children)
    return

  const delta = [ ...children ].length - domElement.children.length

  if (delta > 0 || true === forceOrphanRestoration)
    restoreOrphanedTree(container, recursive)

  // purge child containers existing in tree where
  // the DOM element is not a child of the container
  // DOM element.
  for (let child of [ ...children ]) {
    const childElement = child.domElement
    if (false == domElement.contains(childElement))
      children.delete(child)
  }

  // traverse children
  for (let childElement of [ ...domElement.children ]) {
    const data = childElement[STARDUX_PRIVATE_ATTR]
    const child = 'object' == typeof data ? fetchContainer(data.id) : null

    // skip DOM elements which are not claimed
    // by any existing containers
    if (null == child)
      continue

    children.add(child)

    // recurse child containers
    if (true === recursive)
      realignContainerTree(child, true, forceOrphanRestoration)
  }
}


/**
 * Save a container to the known
 * containers map.
 *
 * @public
 * @param {Container} container
 * @return {Boolean}
 */

export function saveContainer (container) {
  container = fetchContainer(container) || container
  if (container && container.id && !CONTAINERS.has(container.id)) {
    CONTAINERS.set(container.id, container)
    return true
  }
  return false
}

/**
 * Fetch a saved container by id.
 *
 * @public
 * @param {Mixed} arg
 * @return {class Container}
 */

export function fetchContainer (arg) {
  const id = ( arg && arg.id )
             ? arg.id
             : ( arg && arg[STARDUX_PRIVATE_ATTR] )
               ? arg[STARDUX_PRIVATE_ATTR].id
               : arg
  return id ? CONTAINERS.get(id) : null
}

/**
 * Generates a unique hex ID.
 *
 * @public
 * @return {String}
 */

export function createContainerUid () {
  return ( Math.random() ).toString('16').slice(1)
}

/**
 * Returns an interator of all containers.
 *
 * @public
 * @return {Array}
 */

export function getAllContainers () {
  return CONTAINERS.entries()
}

/**
 * Run fn on each container.
 *
 * @public
 * @param {Function} fn
 * @param {Object} [scope = this]
 * @return {class Container}
 */

export function forEachContainer (fn, scope = null) {
  const containers = getAllContainers()
  fn = 'function' == typeof fn ? fn : _ => void 0
  for (let kv of containers)
    fn.call(scope || global, kv[1], containers)
  return Container
}

/**
 * Traverse container tree.
 *
 * @public
 * @param {Container} container
 * @param {Function} fn
 * @param {Object} [scope = this]
 */

export function traverseContainer (container, fn, scope) {
  const children = container.children
  for (let child of [ ...children ]) {
    fn.call(scope || global, child, children)
    traverseContainer(child, fn, scope)
  }
}

/**
 * Remove a container by id or the
 * instance itself.
 *
 * @public
 * @param {String|Container} arg
 * @return {Boolean}
 */

export function removeContainer  (arg) {
  const container = fetchContainer(arg)
  const id = container ? container.id : null
  if (id && CONTAINERS.has(id)) {
    // remove from parent
    if (container.parent)
      container.parent.removeChild(container, false, true)

    CONTAINERS.delete(id)
    return true
  }
  return false
}

/**
 * Replace container with another
 *
 * @public
 * @param {String|Container} existing
 * @param {String|Container} replacement
 * @param {Boolen} [create = false]
 */

export function replaceContainer (existing, replacement, create = false) {
  let replacementContainer = null
  let existingContainer = null

  // get existing container, if the container
  // does not exist then throw an error
  existingContainer = fetchContainer(existing)
  if (null == existingContainer) {
    throw Error( "replaceContainer() called for a container "
               + "that does not exist." )
  }

  // get replacement container if input is not
  // a container already like an ID or DOM element.
  if (false == (replacement instanceof Container))
    replacementContainer = fetchContainer(replacement)
  else
    replacementContainer = replacement

  // if the a replacement didn't exist and
  // create was set to true then create the
  // replacement from the replacement input
  if (null == replacementContainer && true === create)
    replacementContainer = createContainer(replacement)

  // replace existing container with the replacement container
  // by replacing its internal DOM element and updating the
  // internal container map
  if (existingContainer instanceof Container &&
      replacementContainer instanceof Container) {
    removeContainer(existingContainer)
    replaceDOMElement(existingContainer, replacementContainer.domElement)
    saveContainer(replacementContainer)
  }

  return replacementContainer || null
}

/**
 * Clears all saved containers.
 *
 * @public
 * @return {undefined}
 */

export function clearContainers () {
  // remove stardux data for each container
  forEachContainer(container => rmdux(container.domElement))
  // clear containers
  CONTAINERS.clear()
}

/**
 * Replace container element with another
 *
 * @public
 * @param {Container} container
 * @param {Element} domElement
 * @return {Container}
 */

export function replaceDOMElement (container, domElement) {
  const existingData = mkdux(domElement)
  const data = mkdux(container.domElement)
  if (domElement) {
    mkdux(domElement, data)

    const sources = []
    const childElements = [ ...domElement.children ]
    const existingContainer = fetchContainer(existingData.id)

    container[$uid] = existingData.id || data.id || container[$uid]
    container[$domElement] = domElement

    container[$children].clear()

    for (let childElement of childElements)
      storeChildSource(childElement)

    container.update(null, false)

    if (existingContainer) {
      container[$children] = existingContainer[$children]
      realignContainerTree(container, true, true)
    }

    const stack = sources.slice()
    for (let childElement of [ ...domElement.children ])
      restoreChildElementSource(childElement, stack)

    function storeChildSource (node) {
      const data = mkdux(node)
      sources.push(data.src || node.innerHTML)
      for (let child of [ ...node.children ])
        storeChildSource(child)
    }

    function restoreChildElementSource (node, stack) {
      const parser = new Parser()
      const source = stack.shift()
      const data = extend(mkdux(node), {src: source})
      const patch = source ? parser.createPatch(source) : null
      if (patch) patch(node)
      for (let child of [ ...node.children ])
        restoreChildElementSource(child, stack)
    }
  }
  return container
}


/**
 * Container class.
 *
 * @public
 * @class Container
 */

export class Container {

  /**
   * Container constructor.
   *
   * @public
   * @constructor
   * @param {Element|String} domElement
   * @param {Function} ...reducers
   */

  constructor (domElement = null, ...reducers) {
    // ensure DOM element instance
    domElement = ensureDOMElement(domElement)

    /**
     * Container UID
     *
     * @private
     * @type {String}
     */

    this[$uid] = createContainerUid()

    /**
     * Instance root DOM Element.
     *
     * @private
     * @type {Element}
     */

    this[$domElement] = domElement

    /**
     * Middleware set.
     *
     * @private
     * @type {Set}
     */

    this[$middleware] = new Set()

    /**
     * Known container pipes.
     *
     * @private
     * @type {Set}
     */

    this[$pipes] = new Map()

    /**
     * View model.
     *
     * @private
     * @type {Object}
     */

    this[$model] = {}

    /**
     * Child containers.
     *
     * @private
     * @type {Set}
     */

    this[$children] = new Set()

    /**
     * Redux store.
     *
     * @private
     * @type {Object}
     */

    this[$store] = createStore(combineReducers([
      // The root reducer handles container state updates
      // and propagates them to the internal DOM element
      // via starplate templates. The DOM tree is patched,
      // not redrawn. Middleware consumption is also applied
      // here. The state and action objects provided by redux
      // may be modified.
      createRootReducer(this),

      // User provided reducers from the class constructor. The
      // state and action objects may be modified from their original
      // states when dispatched due to middleware side effects applied
      // in  the root reducer.
      ...reducers,

      // Piped reducers are applied when composition occurs between
      // two containers. They are achievd with the pipe() method. All
      // dispatched actions are propagated to the piped container via
      // this reducer. They actually don't reduce state, but simply pass
      // it on. When an update action occurs via an update() on a container
      // all containers it has been piped to will effectively have their
      // update() methods called with the provided data arguments. Please
      // note that any middleware applied to parent of a pipe chain will
      // affect the input of the child of a pipe chain.
      createPipeReducer(this),
    ]))

    // Replace DOM element with itself effectively
    // restoring orphaned or lost stardux data.
    replaceDOMElement(this, domElement)

    // ensure container state identifers found in
    // DOM element source is predefined on the internal
    // state object.
    ensureContainerStateIdentifiers(this)

    // Save this container to the internal container map
    saveContainer(this)

    // Realign parent tree recursively if it exists and restore
    // orphaned child containers. This will cause all
    // child containers to realign themselves recursively.
    if (this.parent)
      realignContainerTree(this.parent, true, true)
    // Realign container and all orphaned child containers if
    // found in the tree. This will cause child containers to
    // realign themselves.
    else
      realignContainerTree(this, true, true)
  }

  /**
   * Copy of the internal state object.
   *
   * @public
   * @type {Object}
   */

  get state () {
    return clone(this[$model])
  }

  /**
   * Dummy setter for the state property.
   *
   * @private
   * @type {Object}
   */

  set state (_) { }

  /**
   * Container id.
   *
   * @public
   * @type {String}
   */

  get id () {
    return this[$uid]
  }

  /**
   * Dummy setter for the id property.
   *
   * @private
   * @type {String}
   */

  set id (_) { }

  /**
   * Getter to return parent container if
   * available. Parent is determined with
   * DOM traversal up the tree. A container can
   * be considered orphaned if it doesn't have a
   * parent DOM element.
   *
   * @public
   * @type {Container|null}
   */

  get parent () {
    const domElement = this.domElement
    let parentElement = domElement && domElement.parentElement
    let parentContainerData = {}
    let parentElementContainer = null
    do {
      if (null == parentElement) break
      parentContainerData = parentElement[STARDUX_PRIVATE_ATTR] || {}
      parentElement = parentElement.parentElement
    } while (!(parentElementContainer = fetchContainer(parentContainerData.id)))
    return parentElementContainer
  }

  /**
   * Dummy setter for the parent property.
   *
   * @public
   * @type {Container|null}
   */

  set parent (_) { }

  /**
   * Getter to return container DOm element.
   *
   * @public
   * @type {Element}
   */

  get domElement () {
    return this[$domElement]
  }

  /**
   * DOM element setter that basically just
   * calls replaceDOMElement(domElement).
   *
   * @public
   * @type {Element}
   */

  set domElement (domElement) {
    if (domElement instanceof Element)
      replaceDOMElement(this, domElement)
    else throw new TypeError( "Cannot set property .domElement. Value must "
                            + "be an Element." )
    return this.domElement
  }

  /**
   * Returns inner contents of the container.
   *
   * @public
   * @type {String}
   */

  get innerContents () {
    return this.domElement.innerHTML || ''
  }

  /**
   * Sets inner contents of DOM content.
   * This will set the template source
   * and update the container. If child
   * containers exist in tree they will
   * become orphaned. If value is null
   * then the value becomes an empty
   * string (''). undefined values result
   * in the string 'undefined'.
   *
   * @public
   * @type {String}
   */

  set innerContents (value) {
    if (null === value)
      value = ''
    const data = mkdux(this)
    data.src = String(value)
    this.update()
  }

  /**
   * Extend view model.
   *
   * @public
   * @param {Object} model
   * @return {Container}
   */

  define (model) {
    if ('object' == typeof model)
      extend(true, this[$model], model)
    return this
  }

  /**
   * Getter to return an array
   * of child containers
   *
   * @public
   * @return {Array}
   */

  get children () {
    return [ ...this[$children].entries() ].map(kv => kv[0])
  }

  /**
   * Consume reducer middleware.
   *
   * @public
   * @param {Function} ...plugins
   * @return {Container}
   */

  use (...plugins) {
    const middleware = this[$middleware]
    for (let plugin of plugins)
      middleware.add(plugin)
    return this
  }

  /**
   * Updates container
   *
   * @public
   * @param {Object} [data = {}]
   * @param {Boolean} [propagate = true]
   * @return {Container}
   */

  update (data, propagate = true) {
    const domElement = this.domElement
    const template = getTemplateFromDomElement(domElement)

    // init/update DOM data
    extend(mkdux(domElement), { id: this[$uid] })
    if (template) {
      extend(mkdux(domElement), {
        src: getTemplateFromDomElement(domElement)
      })
    }

    // pre alignment
    realignContainerTree(this, true, true)

    // update
    this.dispatch($UPDATE_ACTION, data, { propagate: propagate })

    if (propagate) {
      for (let child of [ ...this.children ]) {
        child.update(data || this.state)
      }
    }

    // post alignment
    realignContainerTree(this)
    return this
  }

  /**
   * Render container to a DOM element.
   *
   * @public
   * @param {Element} domElement
   * @return {Container}
   */

  render (domElement) {
    if (!domElement) return this
    if (false == domElement.contains(this[$domElement]))
      domElement.appendChild(this[$domElement])
    return this
  }

  /**
   * Dispatch an event with type and data
   * and optional arguments.
   *
   * @public
   * @param {Mixed} type
   * @param {Object} [data = {}]
   * @param {Object} [args = {}]
   * @return {Container}
   */

  dispatch (type, data = {}, args = {}) {
    if (!type) throw new TypeError("Failed to dispatch event without type.")
    const store = this[$store]
    const payload = {type: type, data: data}
    for (let key in args)
      payload[key] = args[key]
    store.dispatch(payload)
    return this
  }

  /**
   * Replace child tree with new children.
   *
   * @public
   * @param {Array} children
   * @return {Container}
   */

  replaceChildren (children) {
    for (let child of this.children)
      this.removeChild(child, false)

    for (let child of children)
      this.appendChild(child, false)
    return this.update()
  }

  /**
   * Returns the associated value of the
   * container.
   *
   * @public
   * @return {Element}
   */

  valueOf () {
    return this.domElement
  }

  /**
   * Returns the string reprenstation of
   * this container.
   *
   * @public
   * @return {String}
   */

  toString () {
    return this.domElement.textContent
  }

  /**
   * Converts container to a JSON
   * serializable object.
   *
   * @public
   * @return {Object}
   */

  toJSON () {
    const root = {}
    void function traverse (container, node) {
      node.id = container.id
      node.src = getTemplateFromDomElement(container.domElement)
      node.state = container.state || {}
      node.children = []
      for (let child of container.children) {
        const next = {}
        node.children.push(next)
        traverse(child, next)
      }
    }(this, root)
    return root
  }

  /**
   * Pipe container updates to a given container.
   *
   * @public
   * @param {Container} container
   * @return {Container} container
   */

  pipe (container) {
    const pipes = this[$pipes]
    const middleware = (state, action) => {
      switch (action.type) {
        case $UPDATE_ACTION:
          if (action.data) container.update(clone(action.data))
          break
        default:
          container.dispatch(action.type, action.data, action)
      }
    }

    if (false == pipes.has(container)) {
      pipes.set(container, middleware)
    }

    return container
  }

  /**
   * Unpipe container updates for a given container.
   *
   * @public
   * @param {Container} container
   * @return {Container} container
   */

  unpipe (container) {
    const pipes = this[$pipes]
    const reducers = this[$middleware]
    const middleware = pipes.get(container)
    if (middleware) {
      pipes.delete(container)
    }
    return container
  }

  /**
   * Append a child container. A child may be an
   * instance of a Container, Element, Text, or
   * a string. Containers are derived from their input
   * and will cause a DOM tree to be restructured.
   *
   * @public
   * @param {Container|Element|Text|String} child
   * @param {Boolean} [update = true]
   * @param {Boolean} [realign = true]
   * @return {Container}
   */

  appendChild (child, update = true, realign = true) {
    const domElement = this.domElement
    let childDomElement = null
    let container = null

    if (child instanceof Container) {
      container = child
    } else if (child instanceof Element) {
      container = createContainer(child)
    } else if ('string' == typeof child || child instanceof Text) {
      container = createContainer(child)
    } else {
      throw new TypeError( "Unexpected input for appendChild. "
                         + "Expecting an instance of a Container, Element, Text "
                         + "or a string." )
    }

    childDomElement = container.domElement

    if (update) this.update()

    try {
      if (container.parent && container.parent != this) {
        container.parent.removeChild(container)
      }
      domElement.appendChild(childDomElement)
      this[$children].add(container)
    } catch (e) { console.warn(e) }

    if (realign) realignContainerTree(this)

    return container
  }

  /**
   * Remove a child container. A child may be an
   * instance of a Container or Element. Containers
   * are derived from their input and will cause a
   * DOM tree to be restructured.
   *
   * @public
   * @param {Container|Element} child
   * @param {Boolean} [update = true]
   * @param {Boolean} [realign = true]
   * @return {Container}
   */

  removeChild (child, update = true, realign = true) {
    const domElement = this.domElement
    let childDomElement = null
    let container = fetchContainer(child)

    // bail if there is nothing to do
    if (null == container) return this

    childDomElement = container.domElement

    // remove child if it is in tree
    if (domElement.contains(childDomElement))
      domElement.removeChild(childDomElement)

    // remove from container children tree
    this[$children].delete(container)

    // realign tree
    if (realign) realignContainerTree(this)

    return this
  }

  /**
   * Predicate to determine if a container or its
   * DOM element is a child of the container.
   *
   * @public
   * @param {Container|Element} container
   * @param {Boolean} [recursive = true]
   * @return {Boolean}
   */

  contains (container, recursive = true) {
    container = fetchContainer(container)
    if (this[$children].has(container)) {
      return true
    } else if (recursive) {
      for (let child of this.children) {
        if (child.contains(container)) {
          return true
        }
      }
    }
    return false
  }
}
