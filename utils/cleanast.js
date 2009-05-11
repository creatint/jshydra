/**
 * A brief description of some nodes.
 *
 * Scope block information:
 *  variables (Variable[]): a list of variables declared in the block
 *  functions (Function[]): a list of functions declared in the block
 *  constants (Variable[]): a list of constants declared in the block
 *  classes (Class[]): a list of classes declared in the block
 *  objects (Class[]): a list of objects declared in the block
 *  code (Statement[]): a list of statements in the block
 */

/**
 * Takes the node rooted at the AST and decomposes it into readable sections.
 */
function clean_ast(ast) {
  // TOK_LC
  assert(ast.type == 25);
  let info = {
    variables: [],
    constants: [],
    objects: [],
    classes: [],
    functions: [],
    code: []
  };

  for each (let statement in ast.kids) {
    if (statement.op == JSOP_DEFVAR) {
      let ret = make_variables(statement);
      info.variables = info.variables.concat(ret.vars);
      info.objects = info.objects.concat(ret.objs);
    } else if (statement.op == JSOP_DEFCONST) {
      let ret = make_variables(statement);
      info.constants = info.constants.concat(ret.vars);
      info.objects = info.objects.concat(ret.objs);
    } else if (statement.type == 34) { // TOK_FUNCTION
      info.functions.push(make_function(statement));
    } else if (prototype_assign(statement)) {
      let obj = make_class(statement);
      merge_class(info, obj);
    } else {
      info.code.push(statement);
    }
  }
  return info;
}

/**
 * Visits the AST using the given function as a parameter.
 * The parameter will take in a single argument, the AST node.
 */
function visit(root_ast, func, to_expand) {
  function v_r(ast, func) {
    if (ast == null)
      return;
    func(ast);
    for each (let child in ast.kids)
      v_r(child, func);
  }

  function sanitize(ast) {
    if (ast == null)
      return null;
    if (ast.op == JSOP_NAME && ast.atom in to_expand) {
      ast = sanitize(to_expand[ast.atom]);
      ast.expanded = true;
    }
    let sanitized_ast = { kids: [] };
    for (let key in ast) {
      if (key == 'kids') {
        for each (let kid in ast.kids) {
          sanitized_ast.kids.push(sanitize(kid));
        }
      } else {
        sanitized_ast[key] = ast[key];
      }
    }
    return sanitized_ast;
  }

  if (to_expand)
    v_r(sanitize(root_ast), func);
  else
    v_r(root_ast, func);
}

function prototype_assign(statement) {
  if (statement.type != 2 || !statement.kids[0]) // TOK_SEMI
    return false;
  statement = statement.kids[0];
  if (statement.type != 4 || !statement.kids[0]) // TOK_ASSIGN
    return false;

  statement = statement.kids[0];
  // Statement is either prototype or a property of prototype
  if (statement.op != JSOP_SETPROP)
    return false;
  if (statement.atom == "prototype")
    return true;
  if (statement.kids[0] && statement.kids[0] == "prototype")
    return true;

  // Or not!
  return false;
}

function make_class(class_root) {
  let clazz = {};
  
  class_root = class_root.kids[0];
  let lhs = class_root.kids[0], rhs = class_root.kids[1];
  if (lhs.atom == "prototype") {
    clazz.init = rhs;
    clazz = make_object(clazz);
  } else {
    clazz.functions = {};
    clazz.functions[lhs.atom] = make_function(rhs);
    lhs = lhs.kids[0];
  }
  clazz.name = lhs.kids[0].atom;
  return clazz;
}

function merge_class(info_list, obj) {
  let name = obj.name;
  for (let i = 0; i < info_list.functions.length; i++) {
    if (info_list.functions[i].name == name) {
      obj.constructor = info_list.functions[i];
      // XXX: remove from info_list
      break;
    }
  }
  if (obj.constructor)
    obj.loc = obj.constructor.loc;
  let oldObj = null;
  for (let i = 0; i < info_list.classes.length; i++) {
    if (info_list.classes[i].name == name) {
      oldObj = info_list.classes[i];
      break;
    }
  }
  if (oldObj) {
    for (let prop in obj) {
      if (!(prop in oldObj)) {
        oldObj[prop] = obj[prop];
      } else if (typeof obj[prop] == "object") {
        for (let item in obj[prop])
          oldObj[prop][item] = obj[prop][item];
      }
    }
  } else {
    info_list.classes = info_list.classes.concat(obj);
  }
}
function make_variables(var_root) {
  assert(var_root.op == JSOP_DEFVAR || var_root.op == JSOP_DEFCONST);
  let variables = [];
  let objects = [];
  for each (let name in var_root.kids) {
    let v = { name: name.atom };
    v.init = (name.kids.length > 0 ? name.kids[0] : null);
    v.loc = get_location(var_root);
    if (v.init && v.init.op == JSOP_NEWINIT && v.init.kids[0] &&
        v.init.kids[0].type == 6)
      objects.push(make_object(v));
    else
      variables.push(v);
  }
  return { vars: variables, objs: objects };
}

function make_object(stub) {
  stub.variables = {};
  stub.functions = {};
  stub.getters = {};
  stub.setters = {};
  let ast = stub.init;
  delete stub['init'];
  for each (let init in ast.kids) {
    if (init.type != 6) {
      dump_ast(init);
    }
    assert(init.type == 6); // TOK_COLON
    if (init.kids[0].type == 29) { // TOK_NAME
      let name = init.kids[0].atom;
      let value = init.kids[1];
      if (init.op == JSOP_GETTER)
        stub.getters[name] = make_function(value);
      else if (init.op == JSOP_SETTER)
        stub.setters[name] = make_function(value);
      else if (value.type == 34) // TOK_FUNCTION
        stub.functions[name] = make_function(value);
      else if (name == '__proto__' && value.type == 49) { // TOK_NEW
        if ('inherits' in stub)
      stub.inherits.push(value.kids[0].atom);
    else
      stub.inherits = [value.kids[0].atom];
    }
      else
        stub.variables[name] = { loc: get_location(value), init: value };
    } else {
      dump_ast(init);
    }
  }
  return stub;
}

function make_function(func_root) {
  assert(func_root.type == 34); // TOK_FUNCTION
  let stmts = func_root.kids[0];
  if (stmts.type == 85) // TOK_UPVARS
    stmts = stmts.kids[0];
  if (stmts.type == 84) // TOK_ARGSBODY
    stmts = stmts.kids[stmts.kids.length - 1];
  assert(stmts.type == 25);
  return { name: func_root.name, body: stmts, loc: get_location(func_root)};
}

function assert(cmd) {
  if (!cmd) {
    throw new Error("Assertion failed");
  }
}

function get_location(ast_node) {
  return { line: ast_node.line, column: ast_node.column };
}
