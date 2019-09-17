/* eslint-disable no-console */
import React, { Component } from 'react'
import PropTypes from 'prop-types'
import {
  pick,
  get,
  reduce,
  toPath,
  size
} from 'lodash'
import { connect } from 'react-redux'
import LoadingSpinner from 'components/LoadingSpinner'
import { isLoaded, isEmpty } from 'react-redux-firebase/lib/helpers'
import {
  compose,
  mapProps,
  setDisplayName,
  branch,
  renderComponent
} from 'recompose'

/**
 * Show a loading spinner when a condition is truthy. Used within
 * spinnerWhileLoading. Accepts a test function and a higher-order component.
 * @param  {Function} condition - Condition function for when to show spinner
 * @return {HigherOrderComponent}
 */
export function spinnerWhile(condition) {
  return branch(condition, renderComponent(LoadingSpinner))
}

/**
 * Show a loading spinner while props are loading . Checks
 * for undefined, null, or a value (as well as handling `auth.isLoaded` and
 * `profile.isLoaded`). **NOTE:** Meant to be used with props which are passed
 * as props from state.firebase using connect (from react-redux), which means
 * it could have unexpected results for other props
 * @example Spinner While Data Loading
 * import { compose } from 'redux'
 * import { connect } from 'react-redux'
 * import firebaseConnect from 'react-redux-firebase/lib/firebaseConnect'
 *
 * const enhance = compose(
 *   firebaseConnect(['projects']),
 *   connect(({ firebase: { data: { projects } } })),
 *   spinnerWhileLoading(['projects'])
 * )
 *
 * export default enhance(SomeComponent)
 * @param  {Array} propNames - List of prop names to check loading for
 * @return {HigherOrderComponent}
 */
export function spinnerWhileLoading(propNames) {
  if (!propNames || !Array.isArray(propNames)) {
    const missingPropNamesErrMsg = 'spinnerWhileLoading requires propNames array'
    console.error(missingPropNamesErrMsg)
    throw new Error(missingPropNamesErrMsg)
  }
  return spinnerWhile(props =>
    propNames.some(propNames, name => !isLoaded(get(props, name)))
  )
}

/**
 * HOC that shows a component while condition is true
 * @param  {Function} condition - function which returns a boolean indicating
 * whether to render the provided component or not
 * @param  {React.Component} component - React component to render if condition
 * is true
 * @return {HigherOrderComponent}
 */
export function renderWhile(condition, component) {
  return branch(condition, renderComponent(component))
}

/**
 * HOC that shows a component while any of a list of props loaded from Firebase
 * is empty (uses react-redux-firebase's isEmpty).
 * @param  {Array} propNames - List of prop names to check loading for
 * @param  {React.Component} component - React component to render if prop loaded
 * from Firebase is empty
 * @return {HigherOrderComponent}
 * @example
 * renderWhileEmpty(['todos'], () => <div>Todos Not Found</div>),
 */
export function renderWhileEmpty(propsNames, component) {
  if (!propNames || !Array.isArray(propNames)) {
    const missingPropNamesErrMsg = 'renderWhileEmpty requires a propNames array'
    console.error(missingPropNamesErrMsg)
    throw new Error(missingPropNamesErrMsg)
  }
  return renderWhile(
    // Any of the listed prop name correspond to empty props (supporting dot path names)
    props =>
      propsNames.some(name => {
        const propValue = get(props, name)
        return (
          isLoaded(propValue) &&
          (isEmpty(propValue) || (Array.isArray(propValue) && !size(propValue)))
        )
      }),
    component
  )
}

/**
 * HOC that shows a component while any of a list of props isEmpty
 * @param  {Array} listenerPaths - List of listener paths which to check for errors
 * withing Firestore
 * @param  {React.Component} component - React component to render if any of
 * the provied listener paths have errors
 * @return {HigherOrderComponent}
 */
export function renderIfError(listenerPaths, component) {
  return compose(
    connect((state, props) => {
      const {
        firestore: { errors }
      } = state
      const listenerErrors = reduce(
        listenerPaths,
        (acc, listenerConfig) => {
          const listenerName = typeof listenerConfig === 'function'
            ? listenerConfig(state, props)
            : listenerConfig
          const listenerError = get(
            errors,
            `byQuery.${toPath(listenerName).join('/')}`
          )
          if (listenerError) {
            return acc.concat({ name: listenerName, error: listenerError })
          }
          return acc
        },
        []
      )
      return {
        listenerErrors,
        errorMessage: get(listenerErrors, '0.error.code')
      }
    }),
    renderWhile(
      // Any of the listed prop name correspond to empty props (supporting dot path names)
      ({ listenerErrors }) => listenerErrors.length,
      component
    ),
    setDisplayName('renderIfError')
  )
}
